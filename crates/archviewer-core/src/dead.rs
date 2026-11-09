//! Dead code: heuristic entry points, reachability from them, and exports nobody imports.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use crate::graph::Graph;
use crate::model::{
    DeadCode, EntryPoint, EntryReason, FileUsage, ImportKind, NodeId, NodeKind, UnusedExports,
};
use crate::paths::normalize;
use crate::resolve::{Resolution, ResolverSet};

/// Next.js `app/` files that are routes by convention.
const APP_ROUTE_FILES: &[&str] = &[
    "page",
    "layout",
    "route",
    "loading",
    "error",
    "not-found",
    "template",
    "default",
];
const TEST_DIRS: &[&str] = &["__tests__", "test", "tests", "e2e"];

pub(crate) struct DeadData {
    pub public: DeadCode,
    /// Indexed by `NodeId`; `None` for groups and externals.
    pub usage: Vec<Option<(FileUsage, Option<EntryReason>)>>,
    pub unused_exports: HashMap<NodeId, Vec<String>>,
}

fn dir_of(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn join(dir: &str, rel: &str) -> String {
    if dir.is_empty() {
        normalize(rel)
    } else {
        normalize(&format!("{dir}/{rel}"))
    }
}

/// Entry reason from the path alone (framework conventions, config, tests, stories, typings).
fn path_reason(path: &str) -> Option<EntryReason> {
    let name = file_name(path);
    let segments: Vec<&str> = path.split('/').collect();
    let dirs = &segments[..segments.len() - 1];
    let stem = name.split('.').next().unwrap_or(name);
    if dirs.contains(&"pages") || (dirs.contains(&"app") && APP_ROUTE_FILES.contains(&stem)) {
        return Some(EntryReason::Framework);
    }
    if name.contains(".config.") || (name.starts_with('.') && name.contains("rc.")) {
        return Some(EntryReason::Config);
    }
    if name.contains(".test.")
        || name.contains(".spec.")
        || dirs.iter().any(|d| TEST_DIRS.contains(d))
    {
        return Some(EntryReason::Test);
    }
    if name.contains(".stories.") {
        return Some(EntryReason::Story);
    }
    if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") {
        return Some(EntryReason::Declaration);
    }
    None
}

fn string_leaves(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Object(m) => m.values().for_each(|x| string_leaves(x, out)),
        serde_json::Value::Array(a) => a.iter().for_each(|x| string_leaves(x, out)),
        _ => {}
    }
}

/// `main`, `module`, `browser`, `types`, `exports` and `bin` targets, resolved like imports.
fn package_entries(
    pkg_path: &str,
    json: &serde_json::Value,
    resolver: &ResolverSet,
    files: &HashMap<&str, NodeId>,
) -> Vec<String> {
    let mut targets = Vec::new();
    for key in ["main", "module", "browser", "types"] {
        if let Some(serde_json::Value::String(s)) = json.get(key) {
            targets.push(s.clone());
        }
    }
    for key in ["exports", "bin"] {
        if let Some(v) = json.get(key) {
            string_leaves(v, &mut targets);
        }
    }
    let mut out = Vec::new();
    for t in targets {
        if t.contains('*') {
            continue;
        }
        let spec = if t.starts_with("./") || t.starts_with("../") {
            t
        } else {
            format!("./{t}")
        };
        if let Resolution::Internal(p) = resolver.resolve(pkg_path, &spec) {
            if files.contains_key(p.as_str()) {
                out.push(p);
            }
        }
    }
    out
}

/// Code files named in `scripts` (`tsx scripts/gen.ts --out dist`).
fn script_entries(
    pkg_dir: &str,
    json: &serde_json::Value,
    files: &HashMap<&str, NodeId>,
) -> Vec<String> {
    let Some(serde_json::Value::Object(scripts)) = json.get("scripts") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for cmd in scripts.values().filter_map(|v| v.as_str()) {
        for token in cmd.split_whitespace() {
            let token = token.trim_matches(|c| c == '"' || c == '\'');
            let p = join(pkg_dir, token);
            if files.contains_key(p.as_str()) {
                out.push(p);
            }
        }
    }
    out
}

/// Local `<script src>` targets of an `index.html`; `/x` is relative to the HTML's folder.
fn html_entries(html_path: &str, html: &str, files: &HashMap<&str, NodeId>) -> Vec<String> {
    let dir = dir_of(html_path);
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<script").map(|i| i + from) {
        let end = lower[start..].find('>').map_or(lower.len(), |i| i + start);
        let tag = &html[start..end];
        from = end;
        let Some(src_at) = tag.to_ascii_lowercase().find("src=") else {
            continue;
        };
        let rest = &tag[src_at + 4..];
        let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            continue;
        };
        let value = rest[1..].split(quote).next().unwrap_or("");
        let value = value.split(['?', '#']).next().unwrap_or("");
        if value.is_empty() || value.contains("://") || value.starts_with("//") {
            continue;
        }
        let p = join(dir, value.trim_start_matches('/'));
        if files.contains_key(p.as_str()) {
            out.push(p);
        }
    }
    out
}

fn reach(g: &Graph, seeds: &[NodeId]) -> HashSet<NodeId> {
    let mut seen: HashSet<NodeId> = seeds.iter().copied().collect();
    let mut queue: VecDeque<NodeId> = seeds.iter().copied().collect();
    while let Some(id) = queue.pop_front() {
        for &ei in &g.out_edges[id as usize] {
            let to = g.edges[ei].to;
            if g.nodes[to as usize].kind == NodeKind::File && seen.insert(to) {
                queue.push_back(to);
            }
        }
    }
    seen
}

/// Names of a file that some importer uses; `None` means "all of them".
type Used = Option<HashSet<String>>;

fn is_star(e: &crate::graph::FileEdge) -> bool {
    matches!(e.kind, ImportKind::Reexport | ImportKind::TypeOnly) && e.specifiers == ["*"]
}

struct UseFinder<'g> {
    g: &'g Graph,
    entries: &'g HashSet<NodeId>,
    memo: HashMap<NodeId, Used>,
}

impl UseFinder<'_> {
    /// A reexporter with more `*` edges than plain `export *` statements also has
    /// `export * as ns from`, which exposes everything: treat it as "all used".
    fn exposes_namespace(&self, r: NodeId) -> bool {
        let stars = self.g.out_edges[r as usize]
            .iter()
            .filter(|&&ei| is_star(&self.g.edges[ei]))
            .count();
        let plain = self.g.nodes[r as usize]
            .file
            .as_ref()
            .map_or(0, |f| f.exports.iter().filter(|n| *n == "*").count());
        stars > plain
    }

    fn used(&mut self, f: NodeId, visiting: &mut HashSet<NodeId>) -> Used {
        if let Some(u) = self.memo.get(&f) {
            return u.clone();
        }
        if !visiting.insert(f) {
            return Some(HashSet::new());
        }
        let mut names: HashSet<String> = HashSet::new();
        let mut all = false;
        for &ei in &self.g.in_edges[f as usize] {
            let e = &self.g.edges[ei];
            if is_star(e) {
                if self.entries.contains(&e.from) || self.exposes_namespace(e.from) {
                    all = true;
                } else {
                    match self.used(e.from, visiting) {
                        None => all = true,
                        Some(s) => names.extend(s),
                    }
                }
            } else if e.specifiers.iter().any(|s| s == "*")
                || (matches!(e.kind, ImportKind::Dynamic | ImportKind::Require)
                    && e.specifiers.is_empty())
            {
                all = true;
            } else {
                names.extend(e.specifiers.iter().cloned());
            }
            if all {
                break;
            }
        }
        visiting.remove(&f);
        let result = if all { None } else { Some(names) };
        self.memo.insert(f, result.clone());
        result
    }
}

pub(crate) fn analyze(
    g: &Graph,
    configs: &HashMap<String, String>,
    resolver: &ResolverSet,
) -> DeadData {
    let files: HashMap<&str, NodeId> = g
        .nodes
        .iter()
        .filter(|n| n.kind == NodeKind::File)
        .map(|n| (n.path.as_str(), n.id))
        .collect();

    // Production entries from package.json and index.html, then path rules for the rest.
    let mut reasons: BTreeMap<String, EntryReason> = BTreeMap::new();
    let add = |p: String, r: EntryReason, reasons: &mut BTreeMap<String, EntryReason>| {
        let slot = reasons.entry(p).or_insert(r);
        if (r as u8) < (*slot as u8) {
            *slot = r;
        }
    };
    let mut config_paths: Vec<&String> = configs.keys().collect();
    config_paths.sort();
    for path in config_paths {
        let content = &configs[path];
        match file_name(path) {
            "package.json" => {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(content) else {
                    continue;
                };
                for p in package_entries(path, &json, resolver, &files) {
                    add(p, EntryReason::PackageJson, &mut reasons);
                }
                for p in script_entries(dir_of(path), &json, &files) {
                    add(p, EntryReason::Script, &mut reasons);
                }
            }
            "index.html" => {
                for p in html_entries(path, content, &files) {
                    add(p, EntryReason::Html, &mut reasons);
                }
            }
            _ => {}
        }
    }
    for path in files.keys() {
        if let Some(r) = path_reason(path) {
            add(path.to_string(), r, &mut reasons);
        }
    }

    let production = |r: &EntryReason| {
        matches!(
            r,
            EntryReason::PackageJson
                | EntryReason::Script
                | EntryReason::Html
                | EntryReason::Framework
                | EntryReason::Config
        )
    };
    let fallback = !reasons.values().any(|r| {
        matches!(
            r,
            EntryReason::PackageJson
                | EntryReason::Script
                | EntryReason::Html
                | EntryReason::Framework
        )
    });
    let seeds = |want: &dyn Fn(&EntryReason) -> bool| -> Vec<NodeId> {
        reasons
            .iter()
            .filter(|(_, r)| want(r))
            .map(|(p, _)| files[p.as_str()])
            .collect()
    };
    let prod_reach = reach(g, &seeds(&production));
    let test_reach = reach(
        g,
        &seeds(&|r| matches!(r, EntryReason::Test | EntryReason::Story)),
    );

    let mut usage: Vec<Option<(FileUsage, Option<EntryReason>)>> = vec![None; g.nodes.len()];
    let mut unused_files = Vec::new();
    let mut test_only_files = Vec::new();
    let mut sorted: Vec<(&str, NodeId)> = files.iter().map(|(p, id)| (*p, *id)).collect();
    sorted.sort();
    for &(path, id) in &sorted {
        let u = if let Some(r) = reasons.get(path) {
            (FileUsage::Entry, Some(*r))
        } else if fallback {
            if g.in_edges[id as usize].is_empty() {
                (FileUsage::Unused, None)
            } else {
                (FileUsage::Used, None)
            }
        } else if prod_reach.contains(&id) {
            (FileUsage::Used, None)
        } else if test_reach.contains(&id) {
            (FileUsage::TestOnly, None)
        } else {
            (FileUsage::Unused, None)
        };
        match u.0 {
            FileUsage::Unused => unused_files.push(path.to_string()),
            FileUsage::TestOnly => test_only_files.push(path.to_string()),
            _ => {}
        }
        usage[id as usize] = Some(u);
    }

    let entry_ids: HashSet<NodeId> = reasons.keys().map(|p| files[p.as_str()]).collect();
    let mut finder = UseFinder {
        g,
        entries: &entry_ids,
        memo: HashMap::new(),
    };
    let mut unused_exports: HashMap<NodeId, Vec<String>> = HashMap::new();
    let mut public_unused = Vec::new();
    for &(path, id) in &sorted {
        if !matches!(
            usage[id as usize],
            Some((FileUsage::Used | FileUsage::TestOnly, _))
        ) {
            continue;
        }
        let exports = &g.nodes[id as usize]
            .file
            .as_ref()
            .expect("file data")
            .exports;
        let Some(used) = finder.used(id, &mut HashSet::new()) else {
            continue;
        };
        let names: Vec<String> = exports
            .iter()
            .filter(|n| *n != "*" && !used.contains(*n))
            .cloned()
            .collect();
        if !names.is_empty() {
            public_unused.push(UnusedExports {
                path: path.to_string(),
                names: names.clone(),
            });
            unused_exports.insert(id, names);
        }
    }

    DeadData {
        public: DeadCode {
            entries: reasons
                .into_iter()
                .map(|(path, reason)| EntryPoint { path, reason })
                .collect(),
            unused_files,
            test_only_files,
            unused_exports: public_unused,
            fallback,
        },
        usage,
        unused_exports,
    }
}
