//! Import resolution over the in-memory file system, with workspace and
//! tsconfig-scope awareness.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use oxc_resolver::{
    ResolveError, ResolveOptions, ResolverGeneric, TsconfigDiscovery, TsconfigOptions,
    TsconfigReferences,
};

use crate::memfs::{from_virtual, to_virtual, MemoryFs};
use crate::model::{UnresolvedReason, Warning, WarningCode};
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
    /// Resolver per tsconfig actually used (scope root or referenced project).
    cache: Mutex<HashMap<Option<String>, Arc<Resolver>>>,
    fallback: Mutex<Fallback>,
}

/// Scopes whose tsconfig failed inside the resolver; they resolve without it.
#[derive(Default)]
struct Fallback {
    scopes: HashSet<String>,
    warnings: Vec<Warning>,
}

fn is_tsconfig_error(e: &ResolveError) -> bool {
    matches!(
        e,
        ResolveError::TsconfigNotFound(_)
            | ResolveError::TsconfigSelfReference(_)
            | ResolveError::TsconfigCircularExtend(_)
            | ResolveError::TsconfigLoadFailed { .. }
    )
}

/// `paths` keys and sanitized contents collected along an `extends` chain.
#[derive(Default)]
struct Chain {
    /// `paths` keys (own and inherited).
    keys: Vec<String>,
    /// Sanitized contents (unloadable `extends` removed) for chain files that had one.
    overrides: Vec<(String, String)>,
}

/// Result of validating a tsconfig, its relative `extends` chain and its
/// project `references`.
struct ScopeInfo {
    /// `paths` keys (own, inherited and from references).
    keys: Vec<String>,
    /// Overrides for the scope's own tsconfig chain.
    overrides: Vec<(String, String)>,
    /// Referenced projects, in order; empty when a reference could not be
    /// loaded (references are then ignored for the scope).
    projects: Vec<Project>,
}

/// A referenced tsconfig and the files it owns.
struct Project {
    config: String,
    overrides: Vec<(String, String)>,
    files: HashSet<String>,
    include: GlobSet,
    exclude: GlobSet,
}

impl Project {
    fn owns(&self, file: &str) -> bool {
        self.files.contains(file) || (self.include.is_match(file) && !self.exclude.is_match(file))
    }
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

/// Loaded config for an `extends`/`references` target: the file itself, the
/// folder's `tsconfig.json`, or the path with `.json` appended.
fn find_config(target: &str, configs: &HashMap<String, String>) -> Option<String> {
    [
        target.to_string(),
        format!("{target}/tsconfig.json"),
        format!("{target}.json"),
    ]
    .into_iter()
    .find(|c| configs.contains_key(c))
}

/// Validates `path` and its relative `extends` chain into `info`, returning
/// the file's parsed value; `None` when the file is missing or not valid
/// JSONC. `extends` the in-memory file system cannot load (packages,
/// unreachable or invalid relative bases) are dropped from a sanitized copy
/// of the file, keeping its own options. `stack` holds the files being
/// extended; a circular `extends` is left for the resolver to report.
fn analyze_chain(
    path: &str,
    configs: &HashMap<String, String>,
    stack: &mut Vec<String>,
    info: &mut Chain,
    warnings: &mut Vec<Warning>,
) -> Option<serde_json::Value> {
    let value = parse_jsonc(configs.get(path)?)?;
    let extends: Vec<String> = match value.get("extends") {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    };
    let mut kept = Vec::new();
    for ext in &extends {
        if !ext.starts_with('.') {
            continue; // package (or otherwise unloadable) base
        }
        let target = join_rel(parent_dir(path), ext);
        let Some(found) = find_config(&target, configs) else {
            warnings.push(Warning::new(WarningCode::ExtendsNotFound, target.clone()));
            continue;
        };
        if stack.contains(&found) || stack.len() > MAX_EXTENDS_DEPTH {
            kept.push(ext.clone());
            continue;
        }
        stack.push(found.clone());
        let base = analyze_chain(&found, configs, stack, info, warnings);
        stack.pop();
        if base.is_some() {
            kept.push(ext.clone());
        } else {
            warnings.push(Warning::new(WarningCode::InvalidTsconfig, found.clone()));
        }
    }
    if kept.len() != extends.len() {
        let mut sanitized = value.clone();
        if let Some(obj) = sanitized.as_object_mut() {
            if kept.is_empty() {
                obj.remove("extends");
            } else {
                obj.insert("extends".into(), serde_json::json!(kept));
            }
        }
        info.overrides
            .push((path.to_string(), sanitized.to_string()));
    }
    if let Some(paths) = value
        .get("compilerOptions")
        .and_then(|c| c.get("paths"))
        .and_then(|p| p.as_object())
    {
        info.keys.extend(paths.keys().cloned());
    }
    Some(value)
}

fn string_list(value: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    value.get(key).and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    })
}

/// `files`, `include` and `exclude` of a tsconfig (project-relative), each
/// inherited from the relative `extends` chain when not set (later bases win).
type OwnFields = [Option<Vec<String>>; 3];

fn own_fields(path: &str, configs: &HashMap<String, String>, depth: usize) -> OwnFields {
    let Some(value) = configs.get(path).and_then(|c| parse_jsonc(c)) else {
        return [None, None, None];
    };
    let dir = parent_dir(path);
    let mut fields: OwnFields = ["files", "include", "exclude"]
        .map(|k| string_list(&value, k).map(|l| l.iter().map(|p| join_rel(dir, p)).collect()));
    let extends: Vec<String> = match value.get("extends") {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    };
    if depth < MAX_EXTENDS_DEPTH {
        for ext in extends.iter().rev().filter(|e| e.starts_with('.')) {
            let Some(found) = find_config(&join_rel(dir, ext), configs) else {
                continue;
            };
            let base = own_fields(&found, configs, depth + 1);
            for (f, b) in fields.iter_mut().zip(base) {
                if f.is_none() {
                    *f = b;
                }
            }
        }
    }
    fields
}

/// Glob set for tsconfig `include`/`exclude` patterns; a last segment
/// without wildcard or extension names a folder.
fn pattern_set(patterns: &[String]) -> GlobSet {
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let last = p.rsplit('/').next().unwrap_or(p);
        let glob = if last.contains(['*', '?', '.']) {
            p.clone()
        } else if p.is_empty() {
            "**/*".to_string()
        } else {
            format!("{p}/**/*")
        };
        if let Ok(g) = GlobBuilder::new(&glob).literal_separator(true).build() {
            b.add(g);
        }
    }
    b.build().unwrap_or_else(|_| GlobSet::empty())
}

fn project(config: String, chain: Chain, configs: &HashMap<String, String>) -> Project {
    let [files, include, exclude] = own_fields(&config, configs, 0);
    let include = match (&files, include) {
        (_, Some(i)) => i,
        (Some(_), None) => Vec::new(),
        (None, None) => vec![join_rel(parent_dir(&config), "**/*")],
    };
    Project {
        files: files.unwrap_or_default().into_iter().collect(),
        include: pattern_set(&include),
        exclude: pattern_set(&exclude.unwrap_or_default()),
        config,
        overrides: chain.overrides,
    }
}

/// Analyzes a scope's tsconfig and its project `references` (each a file or
/// a folder holding `tsconfig.json`, sanitized like the root). `None` when
/// the root itself is missing or not valid JSONC.
fn analyze_tsconfig(
    path: &str,
    configs: &HashMap<String, String>,
    warnings: &mut Vec<Warning>,
) -> Option<ScopeInfo> {
    let mut chain = Chain::default();
    let value = analyze_chain(
        path,
        configs,
        &mut vec![path.to_string()],
        &mut chain,
        warnings,
    )?;
    let refs = value
        .get("references")
        .and_then(|r| r.as_array())
        .map(|a| a.as_slice())
        .unwrap_or_default();
    let mut projects = Vec::new();
    let mut ref_warnings = Vec::new();
    let mut all_loaded = true;
    for r in refs {
        let Some(rel) = r.get("path").and_then(|p| p.as_str()) else {
            continue; // malformed entry: ignored, as references are resolved here
        };
        let target = join_rel(parent_dir(path), rel);
        let loaded = find_config(&target, configs)
            .filter(|found| found != path)
            .and_then(|found| {
                let mut c = Chain::default();
                analyze_chain(
                    &found,
                    configs,
                    &mut vec![found.clone()],
                    &mut c,
                    &mut ref_warnings,
                )
                .map(|_| (found, c))
            });
        match loaded {
            Some((found, c)) => projects.push((found, c)),
            None => {
                warnings.push(Warning::new(
                    WarningCode::TsconfigReferenceNotFound,
                    target.clone(),
                ));
                all_loaded = false;
            }
        }
    }
    let mut info = ScopeInfo {
        keys: chain.keys,
        overrides: chain.overrides,
        projects: Vec::new(),
    };
    if all_loaded {
        warnings.extend(ref_warnings);
        for (found, c) in projects {
            info.keys.extend(c.keys.iter().cloned());
            info.projects.push(project(found, c, configs));
        }
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
    ) -> (ResolverSet, Vec<Warning>) {
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
            let info = analyze_tsconfig(path, configs, &mut warnings);
            if info.is_none() {
                warnings.push(Warning::new(WarningCode::InvalidTsconfig, path.clone()));
            }
            scopes.insert(path.clone(), info);
        }
        let mut seen = HashSet::new();
        warnings.retain(|w| seen.insert(w.clone()));
        let set = ResolverSet {
            code: code.clone(),
            packages: packages.to_vec(),
            fs,
            scopes,
            cache: Mutex::new(HashMap::new()),
            fallback: Mutex::new(Fallback::default()),
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

    /// The scope's tsconfig when it is valid and has not failed in the resolver.
    fn usable_scope<'a>(&self, scope: Option<&'a str>) -> Option<&'a str> {
        let fallback = self.fallback.lock().unwrap_or_else(|e| e.into_inner());
        scope.filter(|s| {
            matches!(self.scopes.get(*s), Some(Some(_))) && !fallback.scopes.contains(*s)
        })
    }

    /// Resolver using `config` (`None`: without tsconfig), whose chain
    /// files read as `overrides`. References are never followed by the
    /// resolver: `config_for` already picked the owning project.
    fn resolver_for(&self, config: Option<&str>, overrides: &[(String, String)]) -> Arc<Resolver> {
        let key = config.map(String::from);
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = cache.get(&key) {
            return r.clone();
        }
        let options = ResolveOptions {
            extensions: [
                ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts",
            ]
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
            // No "types": it would send deep imports to `dist` declarations.
            condition_names: ["source", "import", "require", "default"]
                .map(String::from)
                .into(),
            tsconfig: config.map(|c| {
                TsconfigDiscovery::Manual(TsconfigOptions {
                    config_file: to_virtual(c),
                    references: TsconfigReferences::Disabled,
                })
            }),
            ..Default::default()
        };
        let mut fs = self.fs.clone();
        for (path, content) in overrides {
            fs = fs.with_override(path, content.clone());
        }
        let r = Arc::new(ResolverGeneric::new_with_file_system(fs, options));
        cache.insert(key, r.clone());
        r
    }

    /// The tsconfig for `file` in a usable scope: the first referenced
    /// project that owns it, else the scope's own tsconfig.
    fn config_for<'a>(&'a self, scope: &'a str, file: &str) -> (&'a str, &'a [(String, String)]) {
        match self.scopes.get(scope) {
            Some(Some(info)) => match info.projects.iter().find(|p| p.owns(file)) {
                Some(p) => (&p.config, &p.overrides),
                None => (scope, &info.overrides),
            },
            _ => (scope, &[]),
        }
    }

    /// Warnings produced while resolving (tsconfigs ignored by the safety net).
    pub fn take_warnings(&self) -> Vec<Warning> {
        let mut fallback = self.fallback.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut fallback.warnings)
    }

    /// Resolves with the tsconfig owning `file`; a tsconfig failure inside
    /// the resolver retries without it and disables the tsconfig for the scope.
    fn resolve_path(
        &self,
        scope: Option<&str>,
        file: &str,
        specifier: &str,
    ) -> Option<std::path::PathBuf> {
        let usable = self.usable_scope(scope);
        let (config, overrides) = match usable {
            Some(s) => {
                let (c, o) = self.config_for(s, file);
                (Some(c), o)
            }
            None => (None, &[][..]),
        };
        let dir = to_virtual(parent_dir(file));
        match self
            .resolver_for(config, overrides)
            .resolve(&dir, specifier)
        {
            Ok(res) => Some(res.path().to_path_buf()),
            Err(e) if usable.is_some() && is_tsconfig_error(&e) => {
                let s = usable.unwrap_or_default();
                {
                    let mut fallback = self.fallback.lock().unwrap_or_else(|e| e.into_inner());
                    if fallback.scopes.insert(s.to_string()) {
                        fallback
                            .warnings
                            .push(Warning::new(WarningCode::TsconfigIgnored, s));
                    }
                }
                self.resolver_for(None, &[])
                    .resolve(&dir, specifier)
                    .ok()
                    .map(|res| res.path().to_path_buf())
            }
            Err(_) => None,
        }
    }

    pub fn resolve(&self, from_file: &str, specifier: &str) -> Resolution {
        if specifier.is_empty() {
            return Resolution::Unresolved(UnresolvedReason::NotFound);
        }
        if is_asset_specifier(specifier) {
            return Resolution::Unresolved(UnresolvedReason::Asset);
        }
        let from_file = crate::paths::normalize(from_file);
        let scope = self.scope_of(&from_file);
        if let Some(path) = self.resolve_path(scope, &from_file, specifier) {
            if let Some(rel) = from_virtual(&path) {
                if self.code.contains(&rel) {
                    return Resolution::Internal(rel);
                }
            }
        }
        // Subpath imports (`#x`) belong to the importing package, never an npm one.
        if is_relative_or_absolute(specifier) || specifier.starts_with('#') {
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

    fn build_with_warnings(code: &[&str], configs: &[(&str, &str)]) -> (ResolverSet, Vec<Warning>) {
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
        assert_eq!(
            warnings,
            vec![Warning::new(WarningCode::InvalidTsconfig, "tsconfig.json")]
        );
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
        assert_eq!(
            w,
            vec![Warning::new(WarningCode::ExtendsNotFound, "missing.json")]
        );
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

    const VITE_ROOT: &str = r#"{"files":[],"references":[{"path":"./tsconfig.node.json"},{"path":"./tsconfig.app.json"}]}"#;
    const VITE_APP: &str = r#"{
        // create-vue style
        "extends": "@vue/tsconfig/tsconfig.dom.json",
        "include": ["src/**/*"],
        "compilerOptions": {"paths": {"@/*": ["./src/*"]}},
    }"#;

    #[test]
    fn references_extending_packages_resolve() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts", "vite.config.ts"],
            &[
                ("tsconfig.json", VITE_ROOT),
                (
                    "tsconfig.node.json",
                    r#"{"extends":"@tsconfig/node22/tsconfig.json","include":["vite.config.ts"]}"#,
                ),
                ("tsconfig.app.json", VITE_APP),
            ],
        );
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@/b"),
            Resolution::Internal("src/b.ts".into())
        );
        // vite.config.ts belongs to tsconfig.node.json, which has no `@/*`.
        assert_eq!(
            r.resolve("vite.config.ts", "@/b"),
            Resolution::Unresolved(UnresolvedReason::UnknownAlias)
        );
        assert_eq!(
            r.resolve("vite.config.ts", "./src/b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert!(r.take_warnings().is_empty());
    }

    #[test]
    fn reference_ownership_follows_include_exclude_and_inherited_fields() {
        let r = set(
            &["src/a.ts", "src/b.ts", "src/gen/g.ts", "lib/l.ts"],
            &[
                (
                    "tsconfig.json",
                    r#"{"files":[],"references":[{"path":"./tsconfig.app.json"}]}"#,
                ),
                (
                    "tsconfig.app.json",
                    r#"{"extends":"./tsconfig.shared.json","exclude":["src/gen"],"compilerOptions":{"paths":{"@/*":["./src/*"]}}}"#,
                ),
                ("tsconfig.shared.json", r#"{"include":["src"]}"#),
            ],
        );
        assert_eq!(
            r.resolve("src/a.ts", "@/b"),
            Resolution::Internal("src/b.ts".into())
        );
        for outside in ["src/gen/g.ts", "lib/l.ts"] {
            assert_eq!(
                r.resolve(outside, "@/b"),
                Resolution::Unresolved(UnresolvedReason::UnknownAlias),
                "{outside}"
            );
        }
    }

    #[test]
    fn missing_reference_warns_and_disables_references() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts"],
            &[(
                "tsconfig.json",
                r#"{"references":[{"path":"./tsconfig.app.json"},{"path":"./packages/x"}]}"#,
            )],
        );
        assert_eq!(
            w,
            vec![
                Warning::new(WarningCode::TsconfigReferenceNotFound, "tsconfig.app.json"),
                Warning::new(WarningCode::TsconfigReferenceNotFound, "packages/x"),
            ]
        );
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert!(r.take_warnings().is_empty());
    }

    #[test]
    fn reference_extending_unloaded_file_resolves() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts"],
            &[
                (
                    "tsconfig.json",
                    r#"{"files":[],"references":[{"path":"./tsconfig.app.json"}]}"#,
                ),
                (
                    "tsconfig.app.json",
                    r#"{"extends":"./config/base.json","include":["src/**/*"]}"#,
                ),
            ],
        );
        assert_eq!(
            w,
            vec![Warning::new(
                WarningCode::ExtendsNotFound,
                "config/base.json"
            )]
        );
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert!(r.take_warnings().is_empty());
    }

    #[test]
    fn reference_to_directory_is_followed() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts", "app/x.ts"],
            &[
                ("tsconfig.json", r#"{"references":[{"path":"./app"}]}"#),
                (
                    "app/tsconfig.json",
                    r#"{"extends":"@tsconfig/node22/tsconfig.json"}"#,
                ),
            ],
        );
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert!(r.take_warnings().is_empty());
    }

    #[test]
    fn unreachable_relative_extends_keeps_own_paths() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts"],
            &[(
                "tsconfig.json",
                r#"{"extends":"./config/base.json","compilerOptions":{"paths":{"@/*":["src/*"]}}}"#,
            )],
        );
        assert_eq!(
            w,
            vec![Warning::new(
                WarningCode::ExtendsNotFound,
                "config/base.json"
            )]
        );
        assert_eq!(
            r.resolve("src/a.ts", "@/b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "@/nope"),
            Resolution::Unresolved(UnresolvedReason::UnknownAlias)
        );
    }

    #[test]
    fn tsconfig_error_at_resolve_falls_back_once() {
        let (r, w) = build_with_warnings(
            &["src/a.ts", "src/b.ts", "src/c.ts"],
            &[
                ("tsconfig.json", r#"{"extends":"./base.json"}"#),
                ("base.json", r#"{"extends":"./tsconfig.json"}"#),
            ],
        );
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(
            r.resolve("src/a.ts", "./b"),
            Resolution::Internal("src/b.ts".into())
        );
        assert_eq!(
            r.resolve("src/a.ts", "./c"),
            Resolution::Internal("src/c.ts".into())
        );
        assert_eq!(
            r.take_warnings(),
            vec![Warning::new(WarningCode::TsconfigIgnored, "tsconfig.json")]
        );
    }

    #[test]
    fn declaration_only_target_resolves() {
        let r = set(&["src/a.ts", "src/types.d.ts"], &[]);
        assert_eq!(
            r.resolve("src/a.ts", "./types"),
            Resolution::Internal("src/types.d.ts".into())
        );
    }

    #[test]
    fn exports_prefer_source_over_types_condition() {
        let r = set(
            &["packages/ui/src/card.tsx", "apps/web/src/main.ts"],
            &[
                ("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n"),
                (
                    "packages/ui/package.json",
                    r#"{"name":"@repo/ui","exports":{"./*":{"types":"./dist/*.d.ts","import":"./src/*.tsx"}}}"#,
                ),
            ],
        );
        assert_eq!(
            r.resolve("apps/web/src/main.ts", "@repo/ui/card"),
            Resolution::Internal("packages/ui/src/card.tsx".into())
        );
    }

    #[test]
    fn empty_and_unknown_subpath_imports_are_not_external() {
        let r = set(&["src/a.ts"], &[]);
        assert_eq!(
            r.resolve("src/a.ts", ""),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
        assert_eq!(
            r.resolve("src/a.ts", "#internal/x"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
        assert_eq!(
            r.resolve("src/a.ts", "#x"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
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
        assert_eq!(
            r.resolve("a.ts", "#x/m"),
            Resolution::Unresolved(UnresolvedReason::NotFound)
        );
    }
}
