//! Default expansion and the aggregated visible graph.

use std::collections::{HashMap, HashSet};

use crate::analyzer::Analyzer;
use crate::graph::Graph;
use crate::model::{GroupKind, ImportKind, NodeId, NodeKind, VEdge, VNode, VisibleGraph};

fn is_group(g: &Graph, id: NodeId) -> bool {
    g.nodes
        .get(id as usize)
        .is_some_and(|n| n.kind == NodeKind::Group)
}

/// Children of expanded (visible) groups that are not expanded themselves.
fn collapsed_frontier(g: &Graph, expanded: &[bool]) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = vec![0 as NodeId];
    while let Some(n) = stack.pop() {
        for &c in &g.nodes[n as usize].children {
            if expanded[c as usize] {
                stack.push(c);
            } else {
                out.push(c);
            }
        }
    }
    out
}

impl Analyzer {
    pub fn default_expansion(&self) -> Vec<NodeId> {
        let Some(g) = self.graph() else {
            return vec![0];
        };
        let mut expanded = vec![false; g.nodes.len()];
        expanded[0] = true;
        for n in &g.nodes {
            if n.group_kind == Some(GroupKind::Package) {
                let mut cur = n.parent;
                while let Some(p) = cur {
                    let pn = &g.nodes[p as usize];
                    if pn.group_kind == Some(GroupKind::Folder) {
                        expanded[p as usize] = true;
                    }
                    cur = pn.parent;
                }
            }
        }
        loop {
            let frontier = collapsed_frontier(g, &expanded);
            match frontier.as_slice() {
                [only] if is_group(g, *only) => expanded[*only as usize] = true,
                _ => break,
            }
        }
        (0..g.nodes.len() as NodeId)
            .filter(|&i| expanded[i as usize])
            .collect()
    }

    pub fn view(&self, expanded: &[NodeId]) -> VisibleGraph {
        let Some(g) = self.graph() else {
            return VisibleGraph {
                nodes: Vec::new(),
                edges: Vec::new(),
            };
        };
        let n = g.nodes.len();
        let mut exp = vec![false; n];
        exp[0] = true;
        for &e in expanded {
            if is_group(g, e) {
                exp[e as usize] = true;
            }
        }

        // One top-down pass: representative (highest collapsed ancestor, or self),
        // visibility, and a traversal order for bottom-up accumulation.
        let mut rep: Vec<NodeId> = (0..n as NodeId).collect();
        let mut visible = vec![false; n];
        let mut order: Vec<NodeId> = Vec::with_capacity(n);
        let mut stack: Vec<(NodeId, Option<NodeId>)> = vec![(0, None)];
        while let Some((id, hidden_by)) = stack.pop() {
            order.push(id);
            for &c in &g.nodes[id as usize].children {
                let child_hidden = match hidden_by {
                    Some(r) => {
                        rep[c as usize] = r;
                        Some(r)
                    }
                    None => {
                        visible[c as usize] = true;
                        (is_group(g, c) && !exp[c as usize]).then_some(c)
                    }
                };
                stack.push((c, child_hidden));
            }
        }

        // Descendant file counts, bottom-up (children appear after parents in `order`).
        let mut files_below = vec![0u32; n];
        for &id in order.iter().rev() {
            let node = &g.nodes[id as usize];
            if node.kind == NodeKind::File {
                files_below[id as usize] = 1;
            }
            if let Some(p) = node.parent {
                files_below[p as usize] += files_below[id as usize];
            }
        }

        let mut nodes: Vec<VNode> = Vec::new();
        for node in &g.nodes {
            let i = node.id as usize;
            let (show, size) = match node.kind {
                NodeKind::External => {
                    let importers: HashSet<NodeId> =
                        g.in_edges[i].iter().map(|&e| g.edges[e].from).collect();
                    (true, importers.len() as u32)
                }
                NodeKind::Group => (visible[i], files_below[i]),
                NodeKind::File => (visible[i], node.file.as_ref().map_or(0, |f| f.loc)),
            };
            if !show {
                continue;
            }
            nodes.push(VNode {
                id: node.id,
                kind: node.kind.clone(),
                label: node.label.clone(),
                path: node.path.clone(),
                size,
                parent_id: node.parent,
                in_cycle: node.in_cycle,
                expandable: node.kind == NodeKind::Group && !node.children.is_empty(),
                expanded: node.kind == NodeKind::Group && exp[i],
            });
        }

        let mut agg: HashMap<(NodeId, NodeId), VEdge> = HashMap::new();
        for e in &g.edges {
            let (from, to) = (rep[e.from as usize], rep[e.to as usize]);
            if from == to {
                continue;
            }
            let entry = agg.entry((from, to)).or_insert(VEdge {
                from,
                to,
                weight: 0,
                in_cycle: false,
                type_only: true,
            });
            entry.weight += 1;
            entry.in_cycle |= e.in_cycle;
            entry.type_only &= e.kind == ImportKind::TypeOnly;
        }
        let mut edges: Vec<VEdge> = agg.into_values().collect();
        edges.sort_by_key(|e| (e.from, e.to));

        VisibleGraph { nodes, edges }
    }
}

#[cfg(test)]
mod tests {
    use crate::analyzer::{analyzed, id, Analyzer};
    use crate::model::AnalyzerConfig;

    #[test]
    fn collapses_single_child_chain() {
        let a = analyzed(&[
            ("src/app/a.ts", "import '../lib/b';"),
            ("src/lib/b.ts", "import 'react';"),
        ]);
        assert_eq!(a.default_expansion(), vec![0, id(&a, "src")]);
    }
    #[test]
    fn aggregates_between_groups() {
        let a = analyzed(&[
            ("src/app/a.ts", "import '../lib/b'; import '../lib/c';"),
            ("src/app/d.ts", "import '../lib/b';"),
            ("src/lib/b.ts", ""),
            ("src/lib/c.ts", "import type {X} from '../app/a';"),
        ]);
        let v = a.view(&a.default_expansion());
        let (app, lib) = (id(&a, "src/app"), id(&a, "src/lib"));
        let e = |f, t| {
            v.edges
                .iter()
                .find(|e| e.from == f && e.to == t)
                .cloned()
                .unwrap()
        };
        assert_eq!(e(app, lib).weight, 3);
        assert!(!e(app, lib).type_only);
        assert!(e(lib, app).type_only);
        assert_eq!(v.nodes.iter().find(|n| n.id == app).unwrap().size, 2);
    }
    #[test]
    fn expanding_reveals_files() {
        let a = analyzed(&[("src/app/a.ts", "import '../lib/b';"), ("src/lib/b.ts", "")]);
        let mut exp = a.default_expansion();
        exp.push(id(&a, "src/lib"));
        let v = a.view(&exp);
        assert!(v
            .edges
            .iter()
            .any(|e| e.from == id(&a, "src/app") && e.to == id(&a, "src/lib/b.ts")));
    }
    #[test]
    fn workspace_packages_on_top() {
        let a = analyzed(&[
            ("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n"),
            ("packages/ui/package.json", r#"{"name":"@acme/ui"}"#),
            ("packages/ui/src/i.ts", ""),
            ("scripts/build.mjs", ""),
        ]);
        let labels: Vec<String> = a
            .view(&a.default_expansion())
            .nodes
            .into_iter()
            .filter(|n| !n.expanded)
            .map(|n| n.label)
            .collect();
        assert_eq!(labels, vec!["@acme/ui", "scripts"]);
    }
    #[test]
    fn invalid_ids_and_before_finish() {
        let a = analyzed(&[("src/a.ts", "")]);
        assert_eq!(a.view(&[999_999, id(&a, "src/a.ts")]), a.view(&[]));
        let b = Analyzer::new(AnalyzerConfig::default());
        assert!(b.view(&[0]).nodes.is_empty());
        assert_eq!(b.default_expansion(), vec![0]);
    }
    #[test]
    fn empty_project() {
        let a = analyzed(&[("README.md", "")]);
        assert_eq!(a.clone_summary().files, 0);
        assert_eq!(a.default_expansion(), vec![0]);
        assert!(a.view(&[0]).nodes.is_empty());
    }
}
