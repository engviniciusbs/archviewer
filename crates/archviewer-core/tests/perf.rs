use std::time::Instant;

use archviewer_core::analyzer::Analyzer;
use archviewer_core::model::{AnalyzerConfig, FileInput, NodeId};

#[test]
#[ignore]
fn twenty_thousand_files_under_five_seconds() {
    const DIRS: usize = 200;
    const PER_DIR: usize = 100;
    let mut files = Vec::with_capacity(DIRS * PER_DIR);
    for d in 0..DIRS {
        for f in 0..PER_DIR {
            let mut src = String::from("import React from 'react';\n");
            for k in 1..=3usize {
                let td = (d + k * 7) % DIRS;
                let tf = (f * 3 + k * 11) % PER_DIR;
                src.push_str(&format!("import {{ v{k} }} from '../m{td}/f{tf}';\n"));
            }
            src.push_str(&format!("export const v = {f};\nvoid React;\n"));
            files.push(FileInput {
                path: format!("m{d}/f{f}.ts"),
                content: src,
            });
        }
    }

    let mut a = Analyzer::new(AnalyzerConfig::default());
    a.add_files(files).unwrap();

    let t = Instant::now();
    let summary = a.finish().unwrap();
    let default = a.view(&a.default_expansion());
    let mut ids = a.default_expansion();
    loop {
        let view = a.view(&ids);
        let new: Vec<NodeId> = view
            .nodes
            .iter()
            .filter(|n| n.expandable && !n.expanded)
            .map(|n| n.id)
            .collect();
        if new.is_empty() {
            break;
        }
        ids.extend(new);
    }
    let full = a.view(&ids);
    let elapsed = t.elapsed();
    eprintln!(
        "perf: files={} edges={} default_nodes={} full_nodes={} full_edges={} elapsed={elapsed:?}",
        summary.files,
        summary.edges,
        default.nodes.len(),
        full.nodes.len(),
        full.edges.len()
    );
    assert_eq!(summary.files, 20_000);
    assert!(elapsed.as_secs_f64() < 5.0, "took {elapsed:?}");
}
