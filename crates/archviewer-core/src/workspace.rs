//! Workspace package detection (pnpm-workspace.yaml / package.json `workspaces`).

use std::collections::{BTreeSet, HashMap};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspacePackage {
    pub name: String,
    pub dir: String,
}

/// Every ancestor directory of every path (normalized, no trailing slash, root excluded).
pub fn dirs_of<'a>(paths: impl Iterator<Item = &'a str>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for p in paths {
        let mut cur = crate::paths::normalize(p);
        while let Some(i) = cur.rfind('/') {
            cur.truncate(i);
            if !cur.is_empty() {
                out.insert(cur.clone());
            }
        }
    }
    out
}

/// A YAML scalar item: a quoted string (anything after the closing quote,
/// like a ` # comment`, is dropped) or a bare word without its ` # comment`.
fn scalar(item: &str) -> &str {
    let item = item.trim();
    for q in ['\'', '"'] {
        if let Some(rest) = item.strip_prefix(q) {
            return rest.find(q).map_or(rest, |i| &rest[..i]);
        }
    }
    item.split(" #").next().unwrap_or(item).trim()
}

/// Items of a single-line flow sequence (`['a/*', "b/*"]`); commas inside
/// quotes do not split.
fn flow_items(flow: &str) -> Vec<String> {
    let inner = flow.trim_start_matches('[');
    let mut items = Vec::new();
    let (mut cur, mut quote) = (String::new(), None);
    for c in inner.chars() {
        match (quote, c) {
            (None, ']') => break,
            (None, ',') => items.push(std::mem::take(&mut cur)),
            (None, '\'' | '"') => {
                quote = Some(c);
                cur.push(c);
            }
            (Some(q), _) if q == c => {
                quote = None;
                cur.push(c);
            }
            _ => cur.push(c),
        }
    }
    items.push(cur);
    items
        .iter()
        .map(|i| scalar(i))
        .filter(|i| !i.is_empty())
        .map(String::from)
        .collect()
}

/// Items under the top-level `packages:` key (block or single-line flow
/// sequence), parsed line by line.
fn pnpm_globs(yaml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    for raw in yaml.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with(char::is_whitespace) && !trimmed.starts_with('-') {
            let rest = trimmed.strip_prefix("packages:");
            inside = rest.is_some();
            if let Some(flow) = rest.map(str::trim_start).filter(|r| r.starts_with('[')) {
                out.extend(flow_items(flow));
                inside = false;
            }
            continue;
        }
        if inside {
            if let Some(item) = trimmed.strip_prefix('-') {
                let item = scalar(item);
                if !item.is_empty() {
                    out.push(item.to_string());
                }
            }
        }
    }
    out
}

fn package_json_globs(value: &serde_json::Value) -> Vec<String> {
    let list = match value.get("workspaces") {
        Some(serde_json::Value::Array(a)) => Some(a),
        Some(serde_json::Value::Object(o)) => o.get("packages").and_then(|p| p.as_array()),
        _ => None,
    };
    list.map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    })
    .unwrap_or_default()
}

fn clean_glob(g: &str) -> String {
    let g = g.trim();
    let (neg, g) = match g.strip_prefix('!') {
        Some(rest) => ("!", rest),
        None => ("", g),
    };
    format!("{neg}{}", g.trim_start_matches("./").trim_end_matches('/'))
}

/// JSON value of a `package.json`, tolerating a UTF-8 BOM.
fn parse_json(content: &str) -> Option<serde_json::Value> {
    serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()
}

/// Builds a set from the valid globs; each invalid one adds a warning.
fn build_set(globs: &[String], warnings: &mut Vec<String>) -> GlobSet {
    let mut b = GlobSetBuilder::new();
    for g in globs {
        match GlobBuilder::new(g).literal_separator(true).build() {
            Ok(glob) => {
                b.add(glob);
            }
            Err(_) => warnings.push(format!("glob inválido: {g}")),
        }
    }
    b.build().unwrap_or_else(|_| GlobSet::empty())
}

pub fn detect_workspaces(
    configs: &HashMap<String, String>,
    dirs: &BTreeSet<String>,
) -> (Vec<WorkspacePackage>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut globs: Vec<String> = Vec::new();
    if let Some(yaml) = configs.get("pnpm-workspace.yaml") {
        globs.extend(pnpm_globs(yaml));
    }
    if let Some(pkg) = configs.get("package.json") {
        match parse_json(pkg) {
            Some(v) => globs.extend(package_json_globs(&v)),
            None => warnings.push("package.json inválido: package.json".to_string()),
        }
    }
    let (neg, pos): (Vec<_>, Vec<_>) = globs
        .iter()
        .map(|g| clean_glob(g))
        .partition(|g| g.starts_with('!'));
    let neg: Vec<String> = neg.into_iter().map(|g| g[1..].to_string()).collect();
    let include = build_set(&pos, &mut warnings);
    let exclude = build_set(&neg, &mut warnings);

    let mut packages = Vec::new();
    for dir in dirs {
        if !include.is_match(dir) || exclude.is_match(dir) {
            continue;
        }
        let pj = format!("{dir}/package.json");
        let Some(content) = configs.get(&pj) else {
            continue;
        };
        match parse_json(content) {
            Some(v) => {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    packages.push(WorkspacePackage {
                        name: name.to_string(),
                        dir: dir.clone(),
                    });
                }
            }
            None => warnings.push(format!("package.json inválido: {pj}")),
        }
    }
    (packages, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(configs: &[(&str, &str)], dirs: &[&str]) -> (Vec<WorkspacePackage>, Vec<String>) {
        let configs: HashMap<String, String> = configs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let dirs: BTreeSet<String> = dirs.iter().map(|d| d.to_string()).collect();
        detect_workspaces(&configs, &dirs)
    }

    #[test]
    fn package_json_workspaces_with_exclusion() {
        let (pkgs, warns) = run(
            &[
                (
                    "package.json",
                    r#"{"workspaces":{"packages":["libs/*","!libs/old"]}}"#,
                ),
                ("libs/new/package.json", r#"{"name":"new"}"#),
                ("libs/old/package.json", r#"{"name":"old"}"#),
                ("libs/new/src/package.json", r#"{"name":"nested"}"#),
            ],
            &["libs", "libs/new", "libs/old", "libs/new/src"],
        );
        assert_eq!(
            pkgs,
            vec![WorkspacePackage {
                name: "new".into(),
                dir: "libs/new".into()
            }]
        );
        assert!(warns.is_empty());
    }

    #[test]
    fn invalid_package_json_warns() {
        let (pkgs, warns) = run(
            &[
                ("package.json", r#"{"workspaces":["libs/*"]}"#),
                ("libs/bad/package.json", "{ nope"),
                ("libs/ok/package.json", r#"{"name":"ok"}"#),
            ],
            &["libs", "libs/bad", "libs/ok"],
        );
        assert_eq!(pkgs.len(), 1);
        assert_eq!(warns, vec!["package.json inválido: libs/bad/package.json"]);
    }

    #[test]
    fn invalid_glob_is_skipped_with_warning() {
        let (pkgs, warns) = run(
            &[
                ("package.json", r#"{"workspaces":["libs/*","libs/["]}"#),
                ("libs/a/package.json", r#"{"name":"a"}"#),
            ],
            &["libs", "libs/a"],
        );
        assert_eq!(pkgs.len(), 1);
        assert!(
            warns.contains(&"glob inválido: libs/[".to_string()),
            "{warns:?}"
        );
    }

    #[test]
    fn pnpm_yaml_forms() {
        let yaml = "# c\npackages:\n  - 'a/*'\n  - \"b/*\"\n  - c/*\n  - '!c/x'\nother:\n  - d/*\n";
        assert_eq!(pnpm_globs(yaml), vec!["a/*", "b/*", "c/*", "!c/x"]);
    }

    #[test]
    fn pnpm_yaml_flow_style() {
        assert_eq!(
            pnpm_globs("packages: ['a/*', \"b/*\", c/*] # c\nother: [d/*]\n"),
            vec!["a/*", "b/*", "c/*"]
        );
        assert_eq!(pnpm_globs("packages: []\n"), Vec::<String>::new());
    }

    #[test]
    fn pnpm_yaml_trailing_comments() {
        let yaml = "packages:\n  - 'a/*' # quoted\n  - \"b/*\"  # dq\n  - c/* # bare\n";
        assert_eq!(pnpm_globs(yaml), vec!["a/*", "b/*", "c/*"]);
    }

    #[test]
    fn negated_glob_with_dot_slash() {
        let (pkgs, warns) = run(
            &[
                (
                    "pnpm-workspace.yaml",
                    "packages:\n  - './libs/*'\n  - '!./libs/old'\n",
                ),
                ("libs/new/package.json", r#"{"name":"new"}"#),
                ("libs/old/package.json", r#"{"name":"old"}"#),
            ],
            &["libs", "libs/new", "libs/old"],
        );
        assert_eq!(
            pkgs.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["new"]
        );
        assert!(warns.is_empty(), "{warns:?}");
    }

    #[test]
    fn package_json_with_bom() {
        let (pkgs, warns) = run(
            &[
                ("package.json", "\u{feff}{\"workspaces\":[\"libs/*\"]}"),
                ("libs/a/package.json", "\u{feff}{\"name\":\"a\"}"),
            ],
            &["libs", "libs/a"],
        );
        assert_eq!(
            pkgs,
            vec![WorkspacePackage {
                name: "a".into(),
                dir: "libs/a".into()
            }]
        );
        assert!(warns.is_empty(), "{warns:?}");
    }

    #[test]
    fn dirs_of_collects_ancestors() {
        let d = dirs_of(["a/b/c.ts", "x.ts", "a/p.json"].into_iter());
        assert_eq!(d.into_iter().collect::<Vec<_>>(), vec!["a", "a/b"]);
    }

    #[test]
    fn crlf_pnpm_workspace_yaml_detects_package() {
        let (pkgs, warns) = run(
            &[
                ("pnpm-workspace.yaml", "packages:\r\n  - 'packages/*'\r\n"),
                ("packages/a/package.json", r#"{"name":"a"}"#),
            ],
            &["packages", "packages/a"],
        );
        assert_eq!(
            pkgs,
            vec![WorkspacePackage {
                name: "a".into(),
                dir: "packages/a".into()
            }]
        );
        assert!(warns.is_empty());
    }
}
