//! Import resolution over the in-memory file system, with workspace and
//! tsconfig-scope awareness.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use oxc_resolver::{
    ResolveOptions, ResolverGeneric, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

use crate::memfs::{from_virtual, to_virtual, MemoryFs};
use crate::model::UnresolvedReason;
use crate::paths::{is_asset_specifier, package_name};
use crate::workspace::WorkspacePackage;

#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    Internal(String),
    External(String),
    Unresolved(UnresolvedReason),
}

type Resolver = ResolverGeneric<MemoryFs>;

pub struct ResolverSet {
    code: HashSet<String>,
    packages: Vec<WorkspacePackage>,
    fs: MemoryFs,
    /// tsconfig/jsconfig path -> analysis, or `None` when invalid.
    scopes: HashMap<String, Option<ScopeInfo>>,
    cache: Mutex<HashMap<Option<String>, Arc<Resolver>>>,
}

/// Result of validating a tsconfig and its relative `extends` chain.
#[derive(Default)]
struct ScopeInfo {
    /// `paths` keys (own and inherited).
    keys: Vec<String>,
    /// Sanitized contents (package `extends` removed) for chain files that had one.
    overrides: Vec<(String, String)>,
}

const MAX_EXTENDS_DEPTH: usize = 16;

fn parent_dir(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

fn join_rel(dir: &str, rel: &str) -> String {
    let mut segs: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for s in rel.split('/') {
        match s {
            "" | "." => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    segs.join("/")
}

fn parse_jsonc(content: &str) -> Option<serde_json::Value> {
    let mut s = content.trim_start_matches('\u{feff}').to_string();
    json_strip_comments::strip(&mut s).ok()?;
    serde_json::from_str(&s).ok()
}

/// Validates a tsconfig and its relative `extends` chain, collecting `paths`
/// keys; `None` when the file (or a relative base) is missing or not valid
/// JSONC. Package `extends` are dropped from a sanitized copy of the file,
/// since the package is not in the in-memory file system.
fn analyze_tsconfig(
    path: &str,
    configs: &HashMap<String, String>,
    depth: usize,
) -> Option<ScopeInfo> {
    if depth > MAX_EXTENDS_DEPTH {
        return None;
    }
    let mut value = parse_jsonc(configs.get(path)?)?;
    let mut info = ScopeInfo::default();
    let extends: Vec<String> = match value.get("extends") {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    };
    let (relative, packages): (Vec<_>, Vec<_>) =
        extends.into_iter().partition(|e| e.starts_with('.'));
    if !packages.is_empty() {
        if let Some(obj) = value.as_object_mut() {
            if relative.is_empty() {
                obj.remove("extends");
            } else {
                obj.insert("extends".into(), serde_json::json!(relative));
            }
        }
        info.overrides.push((path.to_string(), value.to_string()));
    }
    for ext in relative {
        let target = join_rel(parent_dir(path), &ext);
        let found = [
            target.clone(),
            format!("{target}.json"),
            format!("{target}/tsconfig.json"),
        ]
        .into_iter()
        .find(|c| configs.contains_key(c))?;
        let base = analyze_tsconfig(&found, configs, depth + 1)?;
        info.keys.extend(base.keys);
        info.overrides.extend(base.overrides);
    }
    if let Some(paths) = value
        .get("compilerOptions")
        .and_then(|c| c.get("paths"))
        .and_then(|p| p.as_object())
    {
        info.keys.extend(paths.keys().cloned());
    }
    Some(info)
}

fn is_relative_or_absolute(spec: &str) -> bool {
    spec == "."
        || spec == ".."
        || spec.starts_with("./")
        || spec.starts_with("../")
        || spec.starts_with('/')
}

fn matches_alias_key(spec: &str, key: &str) -> bool {
    match key.strip_suffix('*') {
        Some("") => false,
        Some(prefix) => spec.starts_with(prefix),
        None => spec == key,
    }
}

impl ResolverSet {
    pub fn build(
        code: &HashSet<String>,
        configs: &HashMap<String, String>,
        packages: &[WorkspacePackage],
    ) -> (ResolverSet, Vec<String>) {
        let links: Vec<(String, String)> = packages
            .iter()
            .map(|p| (format!("node_modules/{}", p.name), p.dir.clone()))
            .collect();
        let fs = MemoryFs::new(code, configs, &links);

        let mut names: Vec<&String> = configs
            .keys()
            .filter(|p| {
                matches!(
                    p.rsplit('/').next(),
                    Some("tsconfig.json" | "jsconfig.json")
                )
            })
            .collect();
        names.sort();
        let mut scopes = HashMap::new();
        let mut warnings = Vec::new();
        for path in names {
            let info = analyze_tsconfig(path, configs, 0);
            if info.is_none() {
                warnings.push(format!("tsconfig inválido: {path}"));
            }
            scopes.insert(path.clone(), info);
        }
        let set = ResolverSet {
            code: code.clone(),
            packages: packages.to_vec(),
            fs,
            scopes,
            cache: Mutex::new(HashMap::new()),
        };
        (set, warnings)
    }

    /// Closest tsconfig.json / jsconfig.json walking up from the file.
    fn scope_of(&self, from_file: &str) -> Option<&str> {
        let mut dir = parent_dir(from_file);
        loop {
            for name in ["tsconfig.json", "jsconfig.json"] {
                let cand = if dir.is_empty() {
                    name.to_string()
                } else {
                    format!("{dir}/{name}")
                };
                if let Some((k, _)) = self.scopes.get_key_value(&cand) {
                    return Some(k);
                }
            }
            if dir.is_empty() {
                return None;
            }
            dir = parent_dir(dir);
        }
    }

    fn resolver_for(&self, scope: Option<&str>) -> Arc<Resolver> {
        // Invalid tsconfig -> resolver without tsconfig.
        let usable = scope.filter(|s| matches!(self.scopes.get(*s), Some(Some(_))));
        let overrides = usable
            .and_then(|s| self.scopes.get(s))
            .and_then(|i| i.as_ref())
            .map(|i| &i.overrides);
        let key = usable.map(String::from);
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = cache.get(&key) {
            return r.clone();
        }
        let options = ResolveOptions {
            extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
                .map(String::from)
                .into(),
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into()],
                ),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
                (".cjs".into(), vec![".cts".into(), ".cjs".into()]),
            ],
            condition_names: ["types", "import", "require", "default"]
                .map(String::from)
                .into(),
            tsconfig: usable.map(|s| {
                TsconfigDiscovery::Manual(TsconfigOptions {
                    config_file: to_virtual(s),
                    references: TsconfigReferences::Auto,
                })
            }),
            ..Default::default()
        };
        let mut fs = self.fs.clone();
        for (path, content) in overrides.into_iter().flatten() {
            fs = fs.with_override(path, content.clone());
        }
        let r = Arc::new(ResolverGeneric::new_with_file_system(fs, options));
        cache.insert(key, r.clone());
        r
    }

    pub fn resolve(&self, from_file: &str, specifier: &str) -> Resolution {
        if is_asset_specifier(specifier) {
            return Resolution::Unresolved(UnresolvedReason::Asset);
        }
        let from_file = crate::paths::normalize(from_file);
        let scope = self.scope_of(&from_file);
        let resolver = self.resolver_for(scope);
        let dir = to_virtual(parent_dir(&from_file));
        if let Ok(res) = resolver.resolve(&dir, specifier) {
            if let Some(rel) = from_virtual(res.path()) {
                if self.code.contains(&rel) {
                    return Resolution::Internal(rel);
                }
            }
        }
        if is_relative_or_absolute(specifier) {
            return Resolution::Unresolved(UnresolvedReason::NotFound);
        }
        let name = package_name(specifier);
        if let Some(pkg) = self.packages.iter().find(|p| p.name == name) {
            // Source fallback only for the bare package name, not deep imports.
            if specifier != name {
                return Resolution::Unresolved(UnresolvedReason::NotFound);
            }
            for base in [format!("{}/src", pkg.dir), pkg.dir.clone()] {
                for ext in ["ts", "tsx", "js", "jsx"] {
                    let cand = format!("{base}/index.{ext}");
                    if self.code.contains(&cand) {
                        return Resolution::Internal(cand);
                    }
                }
            }
            return Resolution::Unresolved(UnresolvedReason::NotFound);
        }
        let keys = scope
            .and_then(|s| self.scopes.get(s))
            .and_then(|k| k.as_ref())
            .map(|i| &i.keys);
        let by_paths = keys.is_some_and(|ks| ks.iter().any(|k| matches_alias_key(specifier, k)));
        if by_paths || specifier.starts_with("@/") || specifier.starts_with("~/") {
            return Resolution::Unresolved(UnresolvedReason::UnknownAlias);
        }
        Resolution::External(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{detect_workspaces, dirs_of};

    fn build_with_warnings(code: &[&str], configs: &[(&str, &str)]) -> (ResolverSet, Vec<String>) {
        let code_set: HashSet<String> = code.iter().map(|s| s.to_string()).collect();
        let cfg: HashMap<String, String> = configs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let dirs = dirs_of(code.iter().copied().chain(configs.iter().map(|(k, _)| *k)));
        let (pkgs, mut warnings) = detect_workspaces(&cfg, &dirs);
        let (set, w) = ResolverSet::build(&code_set, &cfg, &pkgs);
        warnings.extend(w);
        (set, warnings)
    }

    fn set(code: &[&str], configs: &[(&str, &str)]) -> ResolverSet {
        build_with_warnings(code, configs).0
    }

    #[test]
    fn classifies() {
        let r = set(
            &["src/a.ts", "src/b.ts", "src/lib/m.ts"],
            &[(
                "tsconfig.json",
                r#"{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#,
            )],
        );
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@lib/m"),
            Resolution::Internal("src/lib/m.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@lib/nope"),
            Resolution::Unresolved(UnresolvedReason::UnknownAlias)
        );
        assert_eq!(
            r.resolve("src/a.ts", "~/x"),
            Resolution::Unresolved(UnresolvedReason::UnknownAlias)
        );
        assert_eq!(
            r.resolve("src/a.ts", "./x.module.css"),
            Resolution::Unresolved(UnresolvedReason::Asset)
        );
        assert_eq!(
            r.resolve("src/a.ts", "./missing"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
        assert_eq!(
            r.resolve("src/a.ts", "@scope/pkg/deep"),
            Resolution::External("@scope/pkg".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "node:fs"),
            Resolution::External("node:fs".into())
        );
    }

    #[test]
    fn case_sensitive() {
        let r = set(&["src/a.ts", "src/button.tsx"], &[]);
        assert_eq!(
            r.resolve("src/a.ts", "./Button"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
    }

    #[test]
    fn workspace_packages_and_fallback() {
        let r = set(
            &[
                "packages/ui/src/index.ts",
                "packages/utils/src/index.ts",
                "apps/web/src/main.ts",
            ],
            &[
                (
                    "pnpm-workspace.yaml",
                    "packages:\n  - 'packages/*'\n  - \"apps/*\"\n",
                ),
                (
                    "packages/ui/package.json",
                    r#"{"name":"@acme/ui","exports":{".":"./src/index.ts"}}"#,
                ),
                (
                    "packages/utils/package.json",
                    r#"{"name":"@acme/utils","main":"dist/index.js"}"#,
                ),
                ("apps/web/package.json", r#"{"name":"web"}"#),
            ],
        );
        assert_eq!(
            r.resolve("apps/web/src/main.ts", "@acme/ui"),
            Resolution::Internal("packages/ui/src/index.ts".into())
        );
        assert_eq!(
            r.resolve("apps/web/src/main.ts", "@acme/utils"),
            Resolution::Internal("packages/utils/src/index.ts".into())
        );
    }

    #[test]
    fn workspace_deep_import_has_no_source_fallback() {
        let r = set(
            &["packages/utils/src/index.ts", "apps/web/src/main.ts"],
            &[
                (
                    "pnpm-workspace.yaml",
                    "packages:
  - 'packages/*'
",
                ),
                (
                    "packages/utils/package.json",
                    r#"{"name":"@acme/utils","main":"dist/index.js"}"#,
                ),
            ],
        );
        assert_eq!(
            r.resolve("apps/web/src/main.ts", "@acme/utils/x"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
    }

    #[test]
    fn invalid_tsconfig_warns_and_continues() {
        let (r, warnings) = build_with_warnings(
            &["src/a.ts", "src/b.ts"],
            &[("tsconfig.json", "{ \"compilerOptions\": ")],
        );
        assert_eq!(warnings, vec!["tsconfig inválido: tsconfig.json"]);
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
    }

    #[test]
    fn jsonc_comments_and_trailing_commas_are_valid() {
        let cfg = "{\n // comment\n \"compilerOptions\": {\n \"baseUrl\": \".\", /* c */\n \"paths\": { \"@lib/*\": [\"src/lib/*\",], },\n },\n}\n";
        let (r, warnings) =
            build_with_warnings(&["src/a.ts", "src/lib/m.ts"], &[("tsconfig.json", cfg)]);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(
            r.resolve("src/a.ts", "@lib/m"),
            Resolution::Internal("src/lib/m.ts".into())
        );
    }

    #[test]
    fn extends_rules() {
        let (_, w) = build_with_warnings(
            &["a.ts"],
            &[("tsconfig.json", r#"{"extends":"./missing.json"}"#)],
        );
        assert_eq!(w, vec!["tsconfig inválido: tsconfig.json"]);
        let (_, w) = build_with_warnings(
            &["a.ts"],
            &[(
                "tsconfig.json",
                r#"{"extends":"@tsconfig/node20/tsconfig.json"}"#,
            )],
        );
        assert!(w.is_empty());
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts", "src/lib/m.ts"],
            &[(
                "tsconfig.json",
                r#"{"extends":"@tsconfig/node20/tsconfig.json"}"#,
            )],
        );
        assert!(w.is_empty());
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts", "src/lib/m.ts"],
            &[(
                "tsconfig.json",
                r#"{"extends":"@tsconfig/node20/tsconfig.json","compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#,
            )],
        );
        assert!(w.is_empty());
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@lib/m"),
            Resolution::Internal("src/lib/m.ts".into())
        );
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts"],
            &[
                ("tsconfig.json", r#"{"extends":"./base.json"}"#),
                (
                    "base.json",
                    r#"{"extends":["@tsconfig/node20/tsconfig.json"]}"#,
                ),
            ],
        );
        assert!(w.is_empty());
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/lib/m.ts"],
            &[
                ("tsconfig.json", r#"{"extends":"./tsconfig.base"}"#),
                (
                    "tsconfig.base.json",
                    r#"{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#,
                ),
            ],
        );
        assert!(w.is_empty());
        assert_eq!(
            r.resolve("src/a.ts", "@lib/m"),
            Resolution::Internal("src/lib/m.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@lib/x"),
            Resolution::Unresolved(UnresolvedReason::UnknownAlias)
        );
    }

    #[test]
    fn closest_tsconfig_scope_wins() {
        let r = set(
            &["a.ts", "pkg/src/a.ts", "pkg/src/x/m.ts"],
            &[
                ("tsconfig.json", "{}"),
                (
                    "pkg/tsconfig.json",
                    r##"{"compilerOptions":{"baseUrl":"src","paths":{"#x/*":["x/*"]}}}"##,
                ),
            ],
        );
        assert_eq!(
            r.resolve("pkg/src/a.ts", "#x/m"),
            Resolution::Internal("pkg/src/x/m.ts".into())
        );
        assert_eq!(r.resolve("a.ts", "#x/m"), Resolution::External("#x".into()));
    }
}
