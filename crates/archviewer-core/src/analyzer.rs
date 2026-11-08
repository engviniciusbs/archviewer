//! Stateful analyzer: collect files, then build the graph once with `finish`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;

use crate::graph::Graph;
use crate::model::{
    AddResult, AnalyzerConfig, FileInput, FileParseErrors, Issues, NodeKind, SkipReason,
    SkippedFile, Summary,
};
use crate::parse::{parse_source, ParsedFile};
use crate::paths::{is_code, is_ingestible, normalize};
use crate::resolve::ResolverSet;
use crate::workspace::{detect_workspaces, dirs_of};

#[derive(Debug, Clone, PartialEq)]
pub enum AnalyzerError {
    AlreadyFinished,
}

impl fmt::Display for AnalyzerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AnalyzerError::AlreadyFinished => write!(f, "análise já finalizada"),
        }
    }
}

impl std::error::Error for AnalyzerError {}

pub struct Analyzer {
    config: AnalyzerConfig,
    code: BTreeMap<String, ParsedFile>,
    configs: HashMap<String, String>,
    skipped: Vec<SkippedFile>,
    graph: Option<Graph>,
    summary: Option<Summary>,
    warnings: Vec<String>,
}

impl Analyzer {
    pub fn new(config: AnalyzerConfig) -> Self {
        Self {
            config,
            code: BTreeMap::new(),
            configs: HashMap::new(),
            skipped: Vec::new(),
            graph: None,
            summary: None,
            warnings: Vec::new(),
        }
    }

    pub fn add_files(&mut self, files: Vec<FileInput>) -> Result<AddResult, AnalyzerError> {
        if self.summary.is_some() {
            return Err(AnalyzerError::AlreadyFinished);
        }
        let (mut accepted, mut skipped) = (0u32, 0u32);
        for f in files {
            let path = normalize(&f.path);
            let reason = if !is_ingestible(&path) {
                Some(SkipReason::NotIngestible)
            } else if f.content.len() > self.config.max_file_bytes as usize {
                Some(SkipReason::TooLarge)
            } else {
                None
            };
            if let Some(reason) = reason {
                self.skipped.push(SkippedFile { path, reason });
                skipped += 1;
                continue;
            }
            self.code.remove(&path);
            self.configs.remove(&path);
            if is_code(&path) {
                let parsed = parse_source(&path, &f.content);
                self.code.insert(path, parsed);
            } else {
                self.configs.insert(path, f.content);
            }
            accepted += 1;
        }
        Ok(AddResult { accepted, skipped })
    }

    pub fn finish(&mut self) -> Result<Summary, AnalyzerError> {
        if let Some(s) = &self.summary {
            return Ok(s.clone());
        }
        let code = std::mem::take(&mut self.code);
        let code_paths: HashSet<String> = code.keys().cloned().collect();
        let dirs = dirs_of(code.keys().chain(self.configs.keys()).map(String::as_str));
        let (packages, ws_warnings) = detect_workspaces(&self.configs, &dirs);
        let (resolver, res_warnings) = ResolverSet::build(&code_paths, &self.configs, &packages);

        let mut warnings: Vec<String> = Vec::new();
        for w in ws_warnings.into_iter().chain(res_warnings) {
            if !warnings.contains(&w) {
                warnings.push(w);
            }
        }

        let graph = Graph::build(&self.config.project_name, code, &resolver, &packages);
        let count = |k: NodeKind| graph.nodes.iter().filter(|n| n.kind == k).count() as u32;
        let parse_errors = graph
            .nodes
            .iter()
            .filter(|n| n.file.as_ref().is_some_and(|f| !f.errors.is_empty()))
            .count() as u32;
        let summary = Summary {
            files: count(NodeKind::File),
            edges: graph.edges.len() as u32,
            cycles: graph.cycles.len() as u32,
            externals: count(NodeKind::External),
            unresolved: graph.unresolved.len() as u32,
            skipped: self.skipped.len() as u32,
            parse_errors,
            workspace_packages: packages.len() as u32,
            warnings: warnings.clone(),
        };
        self.warnings = warnings;
        self.graph = Some(graph);
        self.summary = Some(summary.clone());
        Ok(summary)
    }

    pub fn issues(&self) -> Issues {
        let (unresolved, parse_errors) = match &self.graph {
            Some(g) => (
                g.unresolved.clone(),
                g.nodes
                    .iter()
                    .filter_map(|n| {
                        let f = n.file.as_ref()?;
                        (!f.errors.is_empty()).then(|| FileParseErrors {
                            path: n.path.clone(),
                            errors: f.errors.clone(),
                        })
                    })
                    .collect(),
            ),
            None => (
                Vec::new(),
                self.code
                    .iter()
                    .filter(|(_, p)| !p.errors.is_empty())
                    .map(|(path, p)| FileParseErrors {
                        path: path.clone(),
                        errors: p.errors.clone(),
                    })
                    .collect(),
            ),
        };
        Issues {
            unresolved,
            skipped: self.skipped.clone(),
            parse_errors,
            warnings: self.warnings.clone(),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn graph(&self) -> Option<&Graph> {
        self.graph.as_ref()
    }

    #[cfg(test)]
    pub(crate) fn clone_summary(&self) -> Summary {
        self.summary.clone().expect("finish was called")
    }
}

#[cfg(test)]
pub(crate) fn analyzed(files: &[(&str, &str)]) -> Analyzer {
    let mut a = Analyzer::new(AnalyzerConfig::default());
    a.add_files(
        files
            .iter()
            .map(|(p, c)| FileInput {
                path: (*p).to_string(),
                content: (*c).to_string(),
            })
            .collect(),
    )
    .unwrap();
    a.finish().unwrap();
    a
}

#[cfg(test)]
pub(crate) fn id(a: &Analyzer, path: &str) -> crate::model::NodeId {
    a.graph()
        .unwrap()
        .nodes
        .iter()
        .find(|n| n.path == path)
        .unwrap_or_else(|| panic!("no node with path {path}"))
        .id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::UnresolvedReason;

    #[test]
    fn sample_like_graph() {
        let a = analyzed(&[
            ("src/a.ts", "import {b} from './b'; import 'react';"),
            ("src/b.ts", "import {a} from './a';"),
            ("src/c.ts", "import type {A} from './d';"),
            ("src/d.ts", "import type {C} from './c';"),
            ("src/e.ts", "import s from './s.css';"),
        ]);
        let g = a.graph().unwrap();
        let s = a.clone_summary();
        assert_eq!((s.files, s.externals, s.cycles, s.unresolved), (5, 1, 1, 1)); // ciclo só de a↔b; c↔d é typeOnly
        let file = |p: &str| g.nodes.iter().find(|n| n.path == p).unwrap();
        assert!(file("src/a.ts").in_cycle && !file("src/c.ts").in_cycle);
        assert!(file("src").in_cycle);
        assert_eq!(a.issues().unresolved[0].reason, UnresolvedReason::Asset);
    }

    #[test]
    fn skips_and_errors() {
        let mut a = Analyzer::new(AnalyzerConfig::default());
        let r = a
            .add_files(vec![
                FileInput {
                    path: "big.ts".into(),
                    content: "x".repeat(2_097_153),
                },
                FileInput {
                    path: "a.css".into(),
                    content: String::new(),
                },
            ])
            .unwrap();
        assert_eq!((r.accepted, r.skipped), (0, 2));
        a.finish().unwrap();
        assert!(matches!(
            a.add_files(vec![]),
            Err(AnalyzerError::AlreadyFinished)
        ));
        assert_eq!(
            a.issues()
                .skipped
                .iter()
                .map(|s| s.reason.clone())
                .collect::<Vec<_>>(),
            vec![SkipReason::TooLarge, SkipReason::NotIngestible]
        );
    }

    #[test]
    fn backslash_paths_resolve() {
        let a = analyzed(&[("src\\a.ts", "import './b';"), (".\\src\\b.ts", "")]);
        assert_eq!(a.clone_summary().edges, 1);
        assert!(a
            .graph()
            .unwrap()
            .nodes
            .iter()
            .any(|n| n.path == "src/a.ts"));
    }

    #[test]
    fn duplicate_path_last_wins() {
        let mut a = Analyzer::new(AnalyzerConfig::default());
        a.add_files(vec![FileInput {
            path: "a.ts".into(),
            content: "import 'x';".into(),
        }])
        .unwrap();
        a.add_files(vec![FileInput {
            path: "a.ts".into(),
            content: "import 'y';".into(),
        }])
        .unwrap();
        let s = a.finish().unwrap();
        assert_eq!((s.files, s.externals), (1, 1));
    }

    #[test]
    fn deep_chain_no_stack_overflow() {
        let files: Vec<(String, String)> = (0..50_000)
            .map(|i| (format!("f{i}.ts"), format!("import './f{}';", i + 1)))
            .collect();
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(p, c)| (p.as_str(), c.as_str()))
            .collect();
        assert_eq!(analyzed(&refs).clone_summary().cycles, 0);
    }

    #[test]
    fn self_import_is_cycle() {
        assert_eq!(
            analyzed(&[("a.ts", "import './a';")])
                .clone_summary()
                .cycles,
            1
        );
    }

    #[test]
    fn package_group_and_external_node() {
        let a = analyzed(&[
            ("package.json", r#"{"workspaces":["packages/*"]}"#),
            ("packages/ui/package.json", r#"{"name":"@x/ui"}"#),
            ("packages/ui/src/i.ts", "import 'react';"),
        ]);
        let g = a.graph().unwrap();
        let ui = &g.nodes[id(&a, "packages/ui") as usize];
        assert_eq!(ui.group_kind, Some(crate::model::GroupKind::Package));
        assert_eq!(ui.label, "@x/ui");
        let r = &g.nodes[id(&a, "react") as usize];
        assert_eq!((r.kind.clone(), r.parent), (NodeKind::External, None));
        assert_eq!(g.nodes[0].label, "project");
    }
}
