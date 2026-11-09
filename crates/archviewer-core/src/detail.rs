//! Node details and search.

use std::collections::{BTreeMap, HashSet};

use crate::analyzer::Analyzer;
use crate::graph::Graph;
use crate::model::{
    DepRef, Detail, ExternalDetail, FileDetail, FileUsage, GroupDetail, GroupKind, NodeId,
    NodeKind, SearchHit, WeightedRef,
};

const TOP_LIMIT: usize = 10;

fn dep_refs(g: &Graph, edge_ids: &[usize], other_is_target: bool) -> Vec<DepRef> {
    let mut refs: Vec<DepRef> = edge_ids
        .iter()
        .map(|&ei| {
            let e = &g.edges[ei];
            let other = if other_is_target { e.to } else { e.from };
            DepRef {
                id: other,
                path: g.nodes[other as usize].path.clone(),
                kind: e.kind.clone(),
                specifiers: e.specifiers.clone(),
            }
        })
        .collect();
    refs.sort_by(|a, b| a.path.cmp(&b.path));
    refs
}

fn file_descendants(g: &Graph, root: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        let node = &g.nodes[n as usize];
        if node.kind == NodeKind::File {
            out.push(n);
        }
        stack.extend(node.children.iter().copied());
    }
    out
}

/// The node standing for the "other side" of a crossing edge: externals stand for
/// themselves, files for their parent folder.
fn other_side(g: &Graph, id: NodeId) -> NodeId {
    let n = &g.nodes[id as usize];
    match (&n.kind, n.parent) {
        (NodeKind::File, Some(p)) => p,
        _ => id,
    }
}

fn top_refs(g: &Graph, counts: BTreeMap<NodeId, u32>) -> Vec<WeightedRef> {
    let mut refs: Vec<WeightedRef> = counts
        .into_iter()
        .map(|(id, weight)| WeightedRef {
            id,
            path: g.nodes[id as usize].path.clone(),
            weight,
        })
        .collect();
    refs.sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| a.path.cmp(&b.path)));
    refs.truncate(TOP_LIMIT);
    refs
}

fn group_detail(g: &Graph, id: NodeId) -> GroupDetail {
    let n = &g.nodes[id as usize];
    let files = file_descendants(g, id);
    let inside: HashSet<NodeId> = files.iter().copied().collect();
    let loc = files
        .iter()
        .filter_map(|&f| g.nodes[f as usize].file.as_ref())
        .map(|f| f.loc)
        .sum();
    let mut outgoing: BTreeMap<NodeId, u32> = BTreeMap::new();
    let mut incoming: BTreeMap<NodeId, u32> = BTreeMap::new();
    for &f in &files {
        for &ei in &g.out_edges[f as usize] {
            let to = g.edges[ei].to;
            if !inside.contains(&to) {
                *outgoing.entry(other_side(g, to)).or_default() += 1;
            }
        }
        for &ei in &g.in_edges[f as usize] {
            let from = g.edges[ei].from;
            if !inside.contains(&from) {
                *incoming.entry(other_side(g, from)).or_default() += 1;
            }
        }
    }
    GroupDetail {
        id,
        path: n.path.clone(),
        label: n.label.clone(),
        group_kind: n.group_kind.clone().unwrap_or(GroupKind::Folder),
        file_count: files.len() as u32,
        loc,
        in_cycle: n.in_cycle,
        top_outgoing: top_refs(g, outgoing),
        top_incoming: top_refs(g, incoming),
    }
}

/// ASCII-case-insensitive prefix test; `needle` must already be lowercase.
fn starts_with_ci(hay: &str, needle: &str) -> bool {
    hay.len() >= needle.len()
        && hay.as_bytes()[..needle.len()].eq_ignore_ascii_case(needle.as_bytes())
}

/// ASCII-case-insensitive substring test without allocating; `needle` must already be lowercase.
fn contains_ci(hay: &str, needle: &str) -> bool {
    let (h, n) = (hay.as_bytes(), needle.as_bytes());
    n.len() <= h.len() && h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
}

impl Analyzer {
    pub fn detail(&self, id: NodeId) -> Option<Detail> {
        let g = self.graph()?;
        let n = g.nodes.get(id as usize)?;
        Some(match n.kind {
            NodeKind::File => {
                let data = n.file.as_ref()?;
                let outs = &g.out_edges[id as usize];
                let ins = &g.in_edges[id as usize];
                let fan_out = outs.iter().map(|&e| g.edges[e].to).collect::<HashSet<_>>();
                let fan_in = ins.iter().map(|&e| g.edges[e].from).collect::<HashSet<_>>();
                let cycle = g.cycle_of.get(&id).map_or_else(Vec::new, |&ci| {
                    let mut paths: Vec<String> = g.cycles[ci]
                        .iter()
                        .map(|&m| g.nodes[m as usize].path.clone())
                        .collect();
                    paths.sort();
                    paths
                });
                let (usage, entry_reason) = self
                    .dead()
                    .and_then(|d| d.usage[id as usize])
                    .unwrap_or((FileUsage::Used, None));
                let unused_exports = self
                    .dead()
                    .and_then(|d| d.unused_exports.get(&id).cloned())
                    .unwrap_or_default();
                Detail::File(FileDetail {
                    id,
                    path: n.path.clone(),
                    language: data.language.clone(),
                    loc: data.loc,
                    exports: data.exports.clone(),
                    imports: dep_refs(g, outs, true),
                    imported_by: dep_refs(g, ins, false),
                    unresolved: g
                        .unresolved
                        .iter()
                        .filter(|u| u.from == n.path)
                        .cloned()
                        .collect(),
                    cycle,
                    fan_in: fan_in.len() as u32,
                    fan_out: fan_out.len() as u32,
                    parse_errors: data.errors.clone(),
                    usage,
                    entry_reason,
                    unused_exports,
                })
            }
            NodeKind::Group => Detail::Group(group_detail(g, id)),
            NodeKind::External => Detail::External(ExternalDetail {
                id,
                name: n.path.clone(),
                imported_by: dep_refs(g, &g.in_edges[id as usize], false),
            }),
        })
    }

    pub fn find(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let Some(g) = self.graph() else {
            return Vec::new();
        };
        if query.is_empty() || limit == 0 {
            return Vec::new();
        }
        let q = query.to_lowercase();
        type Test = fn(&str, &str) -> bool;
        let (starts, contains): (Test, Test) = if q.is_ascii() {
            (starts_with_ci, contains_ci)
        } else {
            (
                |h, n| h.to_lowercase().starts_with(n),
                |h, n| h.to_lowercase().contains(n),
            )
        };

        // (band, node index): band 0 = label starts with query, 1 = label contains, 2 = path only.
        let mut matches: Vec<(u8, usize)> = Vec::new();
        for (i, n) in g.nodes.iter().enumerate().skip(1) {
            if n.kind == NodeKind::External {
                continue;
            }
            let band = if starts(&n.label, &q) {
                0
            } else if contains(&n.label, &q) {
                1
            } else if contains(&n.path, &q) {
                2
            } else {
                continue;
            };
            matches.push((band, i));
        }
        matches.sort_unstable_by(|a, b| {
            let (pa, pb) = (&g.nodes[a.1].path, &g.nodes[b.1].path);
            a.0.cmp(&b.0)
                .then_with(|| pa.len().cmp(&pb.len()))
                .then_with(|| pa.cmp(pb))
        });
        matches.truncate(limit);
        matches
            .into_iter()
            .map(|(_, i)| {
                let n = &g.nodes[i];
                let mut ancestors = Vec::new();
                let mut cur = n.parent;
                while let Some(p) = cur {
                    ancestors.push(p);
                    cur = g.nodes[p as usize].parent;
                }
                ancestors.reverse();
                SearchHit {
                    id: n.id,
                    kind: n.kind.clone(),
                    label: n.label.clone(),
                    path: n.path.clone(),
                    ancestors,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::{analyzed, id};

    #[test]
    fn file_detail() {
        let a = analyzed(&[
            (
                "src/a.ts",
                "import {x} from './b'; import 'react'; import './gone';",
            ),
            ("src/b.ts", "import './a'; export const x = 1;"),
        ]);
        let Some(Detail::File(d)) = a.detail(id(&a, "src/b.ts")) else {
            panic!()
        };
        assert_eq!((d.fan_in, d.fan_out), (1, 1));
        assert_eq!(d.exports, vec!["x"]);
        assert_eq!(d.cycle, vec!["src/a.ts", "src/b.ts"]);
        assert_eq!(d.imported_by[0].specifiers, vec!["x"]);
        let Some(Detail::File(da)) = a.detail(id(&a, "src/a.ts")) else {
            panic!()
        };
        assert_eq!(da.fan_out, 2);
        assert_eq!(da.unresolved[0].specifier, "./gone");
    }

    #[test]
    fn group_detail_top_deps() {
        let a = analyzed(&[
            (
                "src/app/a.ts",
                "import '../lib/b'; import '../lib/c'; import 'react';",
            ),
            ("src/lib/b.ts", ""),
            ("src/lib/c.ts", ""),
        ]);
        let Some(Detail::Group(g)) = a.detail(id(&a, "src/app")) else {
            panic!()
        };
        assert_eq!(
            g.top_outgoing
                .iter()
                .map(|w| (w.path.as_str(), w.weight))
                .collect::<Vec<_>>(),
            vec![("src/lib", 2), ("react", 1)]
        );
    }

    #[test]
    fn find_ranks_and_ancestors() {
        let a = analyzed(&[
            ("src/components/Button.tsx", ""),
            ("src/ui/IconButton.tsx", ""),
            ("src/button-utils/x.ts", ""),
        ]);
        let hits = a.find("button", 10);
        assert_eq!(
            hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
            vec![
                "src/button-utils",
                "src/components/Button.tsx",
                "src/ui/IconButton.tsx",
                "src/button-utils/x.ts"
            ]
        );
        assert_eq!(
            hits[1].ancestors,
            vec![0, id(&a, "src"), id(&a, "src/components")]
        );
        assert!(a.find("", 10).is_empty());
    }

    #[test]
    fn invalid_id() {
        assert!(analyzed(&[("a.ts", "")]).detail(424_242).is_none());
    }

    #[test]
    fn external_detail_and_incoming() {
        let a = analyzed(&[
            ("src/app/a.ts", "import 'react';"),
            ("src/lib/b.ts", "import '../app/a';"),
            ("z.ts", "import 'react'; import './src/app/a';"),
        ]);
        let Some(Detail::External(e)) = a.detail(id(&a, "react")) else {
            panic!()
        };
        assert_eq!(e.name, "react");
        assert_eq!(
            e.imported_by
                .iter()
                .map(|d| d.path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/app/a.ts", "z.ts"]
        );
        let Some(Detail::Group(g)) = a.detail(id(&a, "src/app")) else {
            panic!()
        };
        assert_eq!(
            g.top_incoming
                .iter()
                .map(|w| (w.path.as_str(), w.weight))
                .collect::<Vec<_>>(),
            vec![("", 1), ("src/lib", 1)]
        );
        assert_eq!(g.file_count, 1);
    }

    #[test]
    fn find_is_case_insensitive_skips_root_and_limits() {
        let a = analyzed(&[("src/Foo.ts", ""), ("src/foo/x.ts", "import 'foo-ext';")]);
        let hits = a.find("FOO", 10);
        assert_eq!(
            hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
            vec!["src/foo", "src/Foo.ts", "src/foo/x.ts"]
        );
        assert_eq!(a.find("foo", 1).len(), 1);
        assert!(a.find("project", 10).iter().all(|h| h.id != 0));
    }
}
