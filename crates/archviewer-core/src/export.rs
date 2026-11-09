//! Whole-graph export: every file, external and edge, keyed by path, in a stable order.

use crate::analyzer::Analyzer;
use crate::graph::{kind_key, Graph};
use crate::model::{
    ExportEdge, ExportExternal, ExportFile, GraphExport, GroupKind, NodeId, NodeKind,
};

pub const SCHEMA: &str = "https://archviewer.viniciusbsarmento.com/schema/graph-v1.json";
pub const VERSION: u32 = 1;

/// Name of the nearest workspace package above `id`, if any.
fn package_of(g: &Graph, id: NodeId) -> Option<String> {
    let mut cur = g.nodes[id as usize].parent;
    while let Some(p) = cur {
        let n = &g.nodes[p as usize];
        if n.group_kind == Some(GroupKind::Package) {
            return Some(n.label.clone());
        }
        cur = n.parent;
    }
    None
}

/// Files and groups are identified by path; externals by package name.
fn key(g: &Graph, id: NodeId) -> &str {
    let n = &g.nodes[id as usize];
    match n.kind {
        NodeKind::External => &n.label,
        _ => &n.path,
    }
}

impl Analyzer {
    /// `None` until `finish` has run.
    pub fn export_graph(&self) -> Option<GraphExport> {
        let g = self.graph()?;
        let summary = self.summary()?.clone();

        let mut files: Vec<ExportFile> = g
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::File)
            .map(|n| {
                let f = n.file.as_ref().expect("file nodes carry file data");
                ExportFile {
                    path: n.path.clone(),
                    language: f.language.clone(),
                    loc: f.loc,
                    package: package_of(g, n.id),
                    in_cycle: n.in_cycle,
                    exports: f.exports.clone(),
                }
            })
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));

        let mut externals: Vec<ExportExternal> = g
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::External)
            .map(|n| ExportExternal {
                name: n.label.clone(),
            })
            .collect();
        externals.sort_by(|a, b| a.name.cmp(&b.name));

        let mut edges: Vec<(u8, ExportEdge)> = g
            .edges
            .iter()
            .map(|e| {
                let external = g.nodes[e.to as usize].kind == NodeKind::External;
                (
                    kind_key(&e.kind),
                    ExportEdge {
                        from: key(g, e.from).to_string(),
                        to: key(g, e.to).to_string(),
                        kind: e.kind.clone(),
                        external,
                        specifiers: e.specifiers.clone(),
                    },
                )
            })
            .collect();
        edges.sort_by(|(ka, a), (kb, b)| (&a.from, &a.to, ka).cmp(&(&b.from, &b.to, kb)));

        let mut cycles: Vec<Vec<String>> = g
            .cycles
            .iter()
            .map(|c| {
                let mut paths: Vec<String> = c.iter().map(|&id| key(g, id).to_string()).collect();
                paths.sort();
                paths
            })
            .collect();
        cycles.sort();

        let issues = self.issues();
        Some(GraphExport {
            schema: SCHEMA.to_string(),
            version: VERSION,
            project: self.project_name().to_string(),
            summary,
            files,
            externals,
            edges: edges.into_iter().map(|(_, e)| e).collect(),
            cycles,
            unresolved: issues.unresolved,
            warnings: issues.warnings,
            dead_code: self.dead_code().unwrap_or_default(),
        })
    }
}
