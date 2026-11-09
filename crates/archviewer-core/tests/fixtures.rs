mod common;

use std::collections::{BTreeSet, HashMap};

use archviewer_core::analyzer::Analyzer;
use archviewer_core::model::{
    AnalyzerConfig, Detail, FileDetail, ImportKind, NodeId, UnresolvedReason, VisibleGraph,
    Warning, WarningCode,
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
        vec![Warning::new(WarningCode::InvalidTsconfig, "tsconfig.json")]
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

fn finished(name: &str) -> Analyzer {
    let mut a = Analyzer::new(AnalyzerConfig {
        project_name: name.into(),
        ..Default::default()
    });
    a.add_files(common::load_fixture(name)).unwrap();
    a.finish().unwrap();
    a
}

#[test]
fn export_sample_project() {
    let mut early = Analyzer::new(AnalyzerConfig::default());
    early
        .add_files(common::load_fixture("sample-project"))
        .unwrap();
    assert!(early.export_graph().is_none());

    let a = finished("sample-project");
    let e = a.export_graph().unwrap();
    assert_eq!(e.version, 1);
    assert_eq!(
        e.schema,
        "https://archviewer.viniciusbsarmento.com/schema/graph-v1.json"
    );
    assert_eq!(e.project, "sample-project");
    assert_eq!(e.files.len(), 8);
    let paths: Vec<&str> = e.files.iter().map(|f| f.path.as_str()).collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);
    assert_eq!(
        e.cycles,
        vec![vec![
            "src/circular/a.ts".to_string(),
            "src/circular/b.ts".to_string()
        ]]
    );
    assert!(e.edges.iter().any(|x| x.to == "react" && x.external));
    assert!(e
        .edges
        .iter()
        .all(|x| x.external != paths.contains(&x.to.as_str())));
    assert!(e.files.iter().all(|f| f.package.is_none()));
    assert_eq!(a.export_graph().unwrap(), e);
    insta::assert_json_snapshot!("export-sample-project", e);
}

#[test]
fn export_monorepo_package() {
    let e = finished("monorepo-pnpm").export_graph().unwrap();
    let main = e
        .files
        .iter()
        .find(|f| f.path == "apps/web/src/main.tsx")
        .unwrap();
    assert_eq!(main.package.as_deref(), Some("web"));
    let button = e
        .files
        .iter()
        .find(|f| f.path == "packages/ui/src/button.tsx")
        .unwrap();
    assert_eq!(button.package.as_deref(), Some("@acme/ui"));
}

#[test]
fn view_metrics() {
    let s = snapshot("sample-project");
    let a = &s.a;
    let by_path =
        |g: &VisibleGraph, p: &str| g.nodes.iter().find(|n| n.path == p).cloned().unwrap();

    // Arquivo: igual ao detalhe.
    let file = by_path(&s.full, "src/circular/a.ts");
    let d = file_detail(&s, "src/circular/a.ts");
    assert_eq!(
        (file.metrics.fan_in, file.metrics.fan_out),
        (d.fan_in, d.fan_out)
    );
    assert_eq!(file.metrics.loc, 11);

    // Grupo recolhido: só conta o que cruza a borda (a <-> b fica de fora).
    let group = by_path(&s.default, "src/circular");
    assert!(!group.expanded);
    let inside = ["src/circular/a.ts", "src/circular/b.ts"];
    let outside_importers: BTreeSet<String> = inside
        .iter()
        .flat_map(|p| file_detail(&s, p).imported_by)
        .map(|r| r.path)
        .filter(|p| !inside.contains(&p.as_str()))
        .collect();
    let outside_imports: BTreeSet<String> = inside
        .iter()
        .flat_map(|p| file_detail(&s, p).imports)
        .map(|r| r.path)
        .filter(|p| !inside.contains(&p.as_str()))
        .collect();
    assert_eq!(group.metrics.fan_in as usize, outside_importers.len());
    assert_eq!(group.metrics.fan_out as usize, outside_imports.len());
    assert_eq!(group.metrics.loc, 22);

    // Externo: importadores distintos, sem saída.
    let react = by_path(&s.default, "react");
    assert!(react.metrics.fan_in >= 1);
    assert_eq!((react.metrics.fan_out, react.metrics.loc), (0, 0));
    let _ = a;
}

#[test]
fn dead_code_fixture() {
    use archviewer_core::model::{EntryReason, FileUsage};
    let s = snapshot("dead-code");
    let d = s.a.dead_code().unwrap();
    let reason = |p: &str| {
        d.entries
            .iter()
            .find(|e| e.path == p)
            .unwrap_or_else(|| panic!("{p} is not an entry: {:?}", d.entries))
            .reason
            .clone()
    };
    assert_eq!(reason("src/index.ts"), EntryReason::PackageJson);
    assert_eq!(reason("src/util/index.ts"), EntryReason::PackageJson);
    assert_eq!(reason("bin/cli.ts"), EntryReason::PackageJson);
    assert_eq!(reason("scripts/gen.ts"), EntryReason::Script);
    assert_eq!(reason("src/web.ts"), EntryReason::Html);
    assert_eq!(reason("app/dashboard/page.tsx"), EntryReason::Framework);
    assert_eq!(reason("vite.config.ts"), EntryReason::Config);
    assert_eq!(reason("src/only-tests.test.ts"), EntryReason::Test);
    assert_eq!(reason("src/button.stories.tsx"), EntryReason::Story);
    assert_eq!(reason("types/global.d.ts"), EntryReason::Declaration);
    let paths: Vec<&str> = d.entries.iter().map(|e| e.path.as_str()).collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);

    assert_eq!(d.unused_files, vec!["src/dead/a.ts", "src/dead/b.ts"]);
    assert_eq!(d.test_only_files, vec!["src/only-tests.ts"]);
    let unused: Vec<(&str, Vec<&str>)> = d
        .unused_exports
        .iter()
        .map(|u| {
            (
                u.path.as_str(),
                u.names.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        unused,
        vec![
            ("src/lib/helper.ts", vec!["unusedHelper", "default"]),
            ("src/named.ts", vec!["notReexported"]),
            ("src/only-tests.ts", vec!["tUnused"]),
        ]
    );
    assert!(!d.fallback);

    let dead_a = file_detail(&s, "src/dead/a.ts");
    assert_eq!(dead_a.usage, FileUsage::Unused);
    assert_eq!(dead_a.entry_reason, None);
    let index = file_detail(&s, "src/index.ts");
    assert_eq!(index.usage, FileUsage::Entry);
    assert_eq!(index.entry_reason, Some(EntryReason::PackageJson));
    let helper = file_detail(&s, "src/lib/helper.ts");
    assert_eq!(helper.usage, FileUsage::Used);
    assert_eq!(helper.unused_exports, vec!["unusedHelper", "default"]);
    assert_eq!(
        file_detail(&s, "src/only-tests.ts").usage,
        FileUsage::TestOnly
    );

    // Agregado na visão: o grupo recolhido src/dead conta os dois arquivos sem uso.
    let src_id = s.full.nodes.iter().find(|n| n.path == "src").unwrap().id;
    let only_src = s.a.view(&[0, src_id]);
    let dead_group = only_src
        .nodes
        .iter()
        .find(|n| n.path == "src/dead")
        .unwrap();
    assert_eq!(dead_group.metrics.unused, 2);
    let file_a = s
        .full
        .nodes
        .iter()
        .find(|n| n.path == "src/dead/a.ts")
        .unwrap();
    assert_eq!(file_a.metrics.unused, 1);

    // O JSON exportado leva o mesmo resultado.
    assert_eq!(s.a.export_graph().unwrap().dead_code, d);
}

#[test]
fn dead_code_falls_back_without_production_entries() {
    let s = snapshot("sample-project");
    let d = s.a.dead_code().unwrap();
    assert!(d.fallback);
    assert!(d.test_only_files.is_empty());
    for p in &d.unused_files {
        assert!(
            file_detail(&s, p).imported_by.is_empty(),
            "{p} has importers"
        );
    }
    assert!(d.unused_files.contains(&"src/index.ts".to_string()));
    assert!(!d.unused_files.contains(&"src/App.tsx".to_string()));
}
