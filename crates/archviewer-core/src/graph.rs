//! Dependency graph: folder/package hierarchy, file and external nodes, edges, cycles.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::cycles::strongly_connected;
use crate::model::{
    GroupKind, ImportKind, Language, NodeId, NodeKind, ParseError, UnresolvedImport,
    UnresolvedReason,
};
use crate::parse::ParsedFile;
use crate::resolve::{Resolution, ResolverSet};
use crate::workspace::WorkspacePackage;

#[derive(Debug, Clone)]
pub(crate) struct FileData {
    pub language: Language,
    pub loc: u32,
    pub exports: Vec<String>,
    pub errors: Vec<ParseError>,
}

#[derive(Debug, Clone)]
pub(crate) struct NodeData {
    pub id: NodeId,
    pub kind: NodeKind,
    pub group_kind: Option<GroupKind>,
    pub path: String,
    pub label: String,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub file: Option<FileData>,
    pub in_cycle: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct FileEdge {
    pub from: NodeId,
    pub to: NodeId,
    pub kind: ImportKind,
    pub specifiers: Vec<String>,
    pub in_cycle: bool,
}

#[derive(Debug)]
pub(crate) struct Graph {
    pub nodes: Vec<NodeData>,
    pub edges: Vec<FileEdge>,
    pub out_edges: Vec<Vec<usize>>,
    pub in_edges: Vec<Vec<usize>>,
    pub cycles: Vec<Vec<NodeId>>,
    pub cycle_of: HashMap<NodeId, usize>,
    pub unresolved: Vec<UnresolvedImport>,
}

type ResolvedImport = (Resolution, ImportKind, Vec<String>, String);

fn kind_key(k: &ImportKind) -> u8 {
    match k {
        ImportKind::Static => 0,
        ImportKind::Dynamic => 1,
        ImportKind::Reexport => 2,
        ImportKind::Require => 3,
        ImportKind::TypeOnly => 4,
    }
}

fn parent_dir(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn push_node(
    nodes: &mut Vec<NodeData>,
    kind: NodeKind,
    group_kind: Option<GroupKind>,
    path: String,
    label: String,
    file: Option<FileData>,
) -> NodeId {
    let id = nodes.len() as NodeId;
    nodes.push(NodeData {
        id,
        kind,
        group_kind,
        path,
        label,
        parent: None,
        children: Vec::new(),
        file,
        in_cycle: false,
    });
    id
}

impl Graph {
    pub(crate) fn build(
        project_name: &str,
        files: BTreeMap<String, ParsedFile>,
        resolver: &ResolverSet,
        packages: &[WorkspacePackage],
    ) -> Graph {
        let package_dirs: HashMap<&str, &str> = packages
            .iter()
            .map(|p| (p.dir.as_str(), p.name.as_str()))
            .collect();

        // Resolve first, so external nodes can be created in sorted order.
        let mut resolved: Vec<(String, Vec<ResolvedImport>)> = Vec::with_capacity(files.len());
        let mut externals: BTreeSet<String> = BTreeSet::new();
        let mut file_data: Vec<(String, FileData)> = Vec::with_capacity(files.len());
        for (path, parsed) in files {
            let mut rs = Vec::with_capacity(parsed.imports.len());
            for imp in parsed.imports {
                let r = resolver.resolve(&path, &imp.specifier);
                if let Resolution::External(name) = &r {
                    externals.insert(name.clone());
                }
                rs.push((r, imp.kind, imp.specifiers, imp.specifier));
            }
            file_data.push((
                path.clone(),
                FileData {
                    language: parsed.language,
                    loc: parsed.loc,
                    exports: parsed.exports,
                    errors: parsed.errors,
                },
            ));
            resolved.push((path, rs));
        }

        let mut nodes: Vec<NodeData> = Vec::new();
        let mut ids: HashMap<String, NodeId> = HashMap::new();

        push_node(
            &mut nodes,
            NodeKind::Group,
            Some(GroupKind::Folder),
            String::new(),
            project_name.to_string(),
            None,
        );
        ids.insert(String::new(), 0);

        // Only folders that are ancestors of code files become groups.
        let mut group_dirs: BTreeSet<&str> = BTreeSet::new();
        for (path, _) in &file_data {
            let mut cur = parent_dir(path);
            while !cur.is_empty() {
                if !group_dirs.insert(cur) {
                    break;
                }
                cur = parent_dir(cur);
            }
        }
        for d in &group_dirs {
            let (gk, label) = match package_dirs.get(d) {
                Some(name) => (GroupKind::Package, (*name).to_string()),
                None => (GroupKind::Folder, base_name(d).to_string()),
            };
            let id = push_node(
                &mut nodes,
                NodeKind::Group,
                Some(gk),
                (*d).to_string(),
                label,
                None,
            );
            ids.insert((*d).to_string(), id);
        }
        for (path, fd) in file_data {
            let label = base_name(&path).to_string();
            let id = push_node(
                &mut nodes,
                NodeKind::File,
                None,
                path.clone(),
                label,
                Some(fd),
            );
            ids.insert(path, id);
        }
        let mut external_ids: HashMap<String, NodeId> = HashMap::new();
        for name in externals {
            let id = push_node(
                &mut nodes,
                NodeKind::External,
                None,
                name.clone(),
                name.clone(),
                None,
            );
            external_ids.insert(name, id);
        }

        // Hierarchy.
        for i in 1..nodes.len() {
            if nodes[i].kind == NodeKind::External {
                continue;
            }
            let pid = ids[parent_dir(&nodes[i].path)];
            nodes[i].parent = Some(pid);
            nodes[pid as usize].children.push(i as NodeId);
        }

        // Edges, unique per (from, to, kind).
        let mut edges: Vec<FileEdge> = Vec::new();
        let mut edge_index: HashMap<(NodeId, NodeId, u8), usize> = HashMap::new();
        let mut unresolved = Vec::new();
        for (path, rs) in resolved {
            let from = ids[&path];
            for (r, kind, specifiers, spec) in rs {
                let to = match r {
                    Resolution::Internal(p) => match ids.get(&p) {
                        Some(&id) if nodes[id as usize].kind == NodeKind::File => id,
                        _ => {
                            unresolved.push(UnresolvedImport {
                                from: path.clone(),
                                specifier: spec,
                                reason: UnresolvedReason::NotFound,
                            });
                            continue;
                        }
                    },
                    Resolution::External(name) => external_ids[&name],
                    Resolution::Unresolved(reason) => {
                        unresolved.push(UnresolvedImport {
                            from: path.clone(),
                            specifier: spec,
                            reason,
                        });
                        continue;
                    }
                };
                let key = (from, to, kind_key(&kind));
                let ei = *edge_index.entry(key).or_insert_with(|| {
                    edges.push(FileEdge {
                        from,
                        to,
                        kind,
                        specifiers: Vec::new(),
                        in_cycle: false,
                    });
                    edges.len() - 1
                });
                for s in specifiers {
                    if !edges[ei].specifiers.contains(&s) {
                        edges[ei].specifiers.push(s);
                    }
                }
            }
        }

        let n = nodes.len();
        let mut out_edges = vec![Vec::new(); n];
        let mut in_edges = vec![Vec::new(); n];
        for (i, e) in edges.iter().enumerate() {
            out_edges[e.from as usize].push(i);
            in_edges[e.to as usize].push(i);
        }

        // Cycles over file->file, non-type-only edges.
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut self_loop: HashSet<usize> = HashSet::new();
        for e in &edges {
            if e.kind == ImportKind::TypeOnly || nodes[e.to as usize].kind != NodeKind::File {
                continue;
            }
            adj[e.from as usize].push(e.to as usize);
            if e.from == e.to {
                self_loop.insert(e.from as usize);
            }
        }
        let mut cycles: Vec<Vec<NodeId>> = strongly_connected(n, &adj)
            .into_iter()
            .filter(|c| c.len() > 1 || self_loop.contains(&c[0]))
            .map(|c| {
                let mut c: Vec<NodeId> = c.into_iter().map(|x| x as NodeId).collect();
                c.sort_unstable();
                c
            })
            .collect();
        cycles.sort();
        let mut cycle_of = HashMap::new();
        for (ci, c) in cycles.iter().enumerate() {
            for &id in c {
                cycle_of.insert(id, ci);
                let mut cur = Some(id);
                while let Some(x) = cur {
                    nodes[x as usize].in_cycle = true;
                    cur = nodes[x as usize].parent;
                }
            }
        }
        for e in edges.iter_mut() {
            if e.kind == ImportKind::TypeOnly {
                continue;
            }
            if let (Some(a), Some(b)) = (cycle_of.get(&e.from), cycle_of.get(&e.to)) {
                e.in_cycle = a == b;
            }
        }

        Graph {
            nodes,
            edges,
            out_edges,
            in_edges,
            cycles,
            cycle_of,
            unresolved,
        }
    }
}
