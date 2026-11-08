mod common;

use std::collections::{BTreeSet, HashMap};

use archviewer_core::analyzer::Analyzer;
use archviewer_core::model::{
    AnalyzerConfig, Detail, FileDetail, ImportKind, NodeId, UnresolvedReason, VisibleGraph,
};
use serde_json::{json, Value};

fn expand_all(a: &Analyzer) -> Vec<NodeId> {
    let mut ids = a.default_expansion();
    loop {
        let view = a.view(&ids);
        let mut changed = false;
        for n in &view.nodes {
            if n.expandable && !n.expanded && !ids.contains(&n.id) {
                ids.push(n.id);
                changed = true;
            }
        }
        if !changed {
            return ids;
        }
    }
}

fn paths(g: &VisibleGraph) -> Value {
    let by_id: HashMap<NodeId, &str> = g.nodes.iter().map(|n| (n.id, n.path.as_str())).collect();
    let nodes: Vec<Value> = g
        .nodes
        .iter()
        .map(|n| {
            json!({
                "path": n.path, "label": n.label, "kind": n.kind, "size": n.size,
                "parent": n.parent_id.and_then(|p| by_id.get(&p).copied()),
                "inCycle": n.in_cycle, "expandable": n.expandable, "expanded": n.expanded,
            })
        })
        .collect();
    let edges: Vec<Value> = g
        .edges
        .iter()
        .map(|e| {
            json!({
                "from": by_id[&e.from], "to": by_id[&e.to], "weight": e.weight,
                "inCycle": e.in_cycle, "typeOnly": e.type_only,
            })
        })
        .collect();
    json!({ "nodes": nodes, "edges": edges })
}

struct Snap {
    a: Analyzer,
    value: Value,
    default: VisibleGraph,
    full: VisibleGraph,
}

fn snapshot(name: &str) -> Snap {
    let mut a = Analyzer::new(AnalyzerConfig {
        project_name: name.into(),
        ..Default::default()
    });
    a.add_files(common::load_fixture(name)).unwrap();
    let summary = a.finish().unwrap();
    let all_groups = expand_all(&a);
    let default = a.view(&a.default_expansion());
    let full = a.view(&all_groups);
    let value = json!({
        "summary": summary, "default": paths(&default),
        "full": paths(&full), "issues": a.issues(),
    });
    Snap {
        a,
        value,
        default,
        full,
    }
}

fn has_edge(v: &Value, from: &str, to: &str) -> bool {
    v["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["from"] == from && e["to"] == to)
}

fn file_detail(s: &Snap, path: &str) -> FileDetail {
    let n = s
        .full
        .nodes
        .iter()
        .find(|n| n.path == path)
        .unwrap_or_else(|| panic!("{path} not in full view"));
    match s.a.detail(n.id) {
        Some(Detail::File(d)) => d,
        other => panic!("{path}: {other:?}"),
    }
}

fn unresolved(s: &Snap) -> Vec<(String, UnresolvedReason)> {
    let mut v: Vec<_> =
        s.a.issues()
            .unresolved
            .into_iter()
            .map(|u| (u.specifier, u.reason))
            .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

fn kind_to(d: &FileDetail, to: &str) -> Option<ImportKind> {
    d.imports
        .iter()
        .find(|r| r.path == to)
        .map(|r| r.kind.clone())
}

#[test]
fn sample_project() {
    let s = snapshot("sample-project");
    assert_eq!(s.value["summary"]["cycles"], 1);
    assert!(unresolved(&s)
        .iter()
        .any(|(sp, r)| sp == "./Button.module.css" && *r == UnresolvedReason::Asset));
    assert!(has_edge(
        &s.value["full"],
        "src/dynamic/lazy.ts",
        "src/utils/helpers.ts"
    ));
    let app = file_detail(&s, "src/App.tsx");
    assert!(app.imports.iter().any(
        |d| d.path == "src/utils/helpers.ts" && d.specifiers.iter().any(|x| x == "formatDate")
    ));
    insta::assert_json_snapshot!("sample-project", s.value);
}

#[test]
fn tsconfig_paths() {
    let s = snapshot("tsconfig-paths");
    let full = &s.value["full"];
    assert!(has_edge(full, "src/main.ts", "src/lib/math.ts"));
    assert!(has_edge(full, "src/main.ts", "src/util.ts"));
    assert_eq!(
        unresolved(&s),
        vec![
            ("@lib/nope".to_string(), UnresolvedReason::UnknownAlias),
            ("~/missing".to_string(), UnresolvedReason::UnknownAlias),
        ]
    );
    insta::assert_json_snapshot!("tsconfig-paths", s.value);
}

#[test]
fn monorepo_pnpm() {
    let s = snapshot("monorepo-pnpm");
    assert_eq!(s.value["summary"]["workspacePackages"], 3);
    let labels: BTreeSet<&str> = s
        .default
        .nodes
        .iter()
        .filter(|n| !n.expanded)
        .map(|n| n.label.as_str())
        .collect();
    let want: BTreeSet<&str> = ["web", "@acme/ui", "@acme/utils", "scripts", "react"].into();
    assert_eq!(labels, want);
    let web = file_detail(&s, "apps/web/src/main.tsx");
    assert!(web
        .imports
        .iter()
        .any(|d| d.path == "packages/ui/src/button.tsx"));
    insta::assert_json_snapshot!("monorepo-pnpm", s.value);
}

#[test]
fn commonjs() {
    let s = snapshot("commonjs");
    let idx = file_detail(&s, "index.js");
    assert_eq!(kind_to(&idx, "a.js"), Some(ImportKind::Require));
    assert_eq!(kind_to(&idx, "lib/b.js"), Some(ImportKind::Require));
    let b = file_detail(&s, "lib/b.js");
    assert_eq!(kind_to(&b, "a.js"), Some(ImportKind::Dynamic));
    assert_eq!(file_detail(&s, "a.js").exports, vec!["x", "y"]);
    insta::assert_json_snapshot!("commonjs", s.value);
}

#[test]
fn broken() {
    let s = snapshot("broken");
    let issues = s.a.issues();
    assert_eq!(
        issues.warnings,
        vec!["tsconfig inválido: tsconfig.json".to_string()]
    );
    assert_eq!(issues.parse_errors[0].path, "src/bad.ts");
    assert_eq!(issues.parse_errors[0].errors[0].line, 2);
    assert_eq!(
        unresolved(&s),
        vec![
            ("./missing".to_string(), UnresolvedReason::NotFound),
            ("./styles.css?inline".to_string(), UnresolvedReason::Asset),
        ]
    );
    insta::assert_json_snapshot!("broken", s.value);
}
