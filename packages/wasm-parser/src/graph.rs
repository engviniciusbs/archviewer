use std::collections::{HashMap, HashSet};

use crate::types::*;

/// Build the complete graph from parsed file results.
pub fn build_graph(files: &[(String, crate::parser::ParseResult)], config: &GraphConfig) -> GraphData {
    let mut nodes: Vec<Node> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut errors: Vec<ParseError> = Vec::new();
    let mut known_files: HashSet<String> = HashSet::new();
    let mut external_deps: HashSet<String> = HashSet::new();

    // Register all known file paths
    for (path, _) in files {
        known_files.insert(normalize_path(path));
    }

    // Build nodes and edges
    for (path, result) in files {
        let normalized = normalize_path(path);
        let language = detect_language(path);

        for err_msg in &result.errors {
            errors.push(ParseError {
                file: normalized.clone(),
                message: err_msg.clone(),
                line: 0,
                column: 0,
            });
        }

        nodes.push(Node {
            id: normalized.clone(),
            path: normalized.clone(),
            node_type: NodeType::File,
            language: language.to_string(),
            exports: result.exports.clone(),
            loc: result.loc,
            parse_error: result.errors.first().cloned(),
        });

        for import in &result.imports {
            let resolved = resolve_import(&normalized, &import.source, &known_files, config);

            match &resolved {
                ResolvedImport::Internal(target) => {
                    edges.push(Edge {
                        source: normalized.clone(),
                        target: target.clone(),
                        imports: import.specifiers.clone(),
                        edge_type: import.import_type.clone(),
                        circular: false,
                    });
                }
                ResolvedImport::External(name) => {
                    external_deps.insert(name.clone());
                    edges.push(Edge {
                        source: normalized.clone(),
                        target: name.clone(),
                        imports: import.specifiers.clone(),
                        edge_type: import.import_type.clone(),
                        circular: false,
                    });
                }
                ResolvedImport::Unresolved(raw) => {
                    edges.push(Edge {
                        source: normalized.clone(),
                        target: raw.clone(),
                        imports: import.specifiers.clone(),
                        edge_type: import.import_type.clone(),
                        circular: false,
                    });
                }
            }
        }
    }

    for dep in &external_deps {
        nodes.push(Node {
            id: dep.clone(),
            path: dep.clone(),
            node_type: NodeType::External,
            language: String::new(),
            exports: vec![],
            loc: 0,
            parse_error: None,
        });
    }

    detect_cycles(&mut edges, &known_files);

    let total_files = nodes.iter().filter(|n| matches!(n.node_type, NodeType::File)).count() as u32;
    let total_edges = edges.len() as u32;

    GraphData {
        nodes,
        edges,
        metadata: Metadata {
            total_files,
            total_edges,
            parse_time_ms: 0.0,
            errors,
        },
    }
}

#[derive(Debug, Clone)]
pub struct GraphConfig {
    pub path_aliases: HashMap<String, String>,
}

impl Default for GraphConfig {
    fn default() -> Self {
        Self {
            path_aliases: HashMap::new(),
        }
    }
}

enum ResolvedImport {
    Internal(String),
    External(String),
    Unresolved(String),
}

fn resolve_import(
    from_path: &str,
    import_source: &str,
    known_files: &HashSet<String>,
    config: &GraphConfig,
) -> ResolvedImport {
    for (alias, replacement) in &config.path_aliases {
        if import_source.starts_with(alias) {
            let resolved = import_source.replacen(alias, replacement, 1);
            let normalized = normalize_path(&resolved);
            if let Some(found) = try_resolve_file(&normalized, known_files) {
                return ResolvedImport::Internal(found);
            }
        }
    }

    if import_source.starts_with('.') {
        let from_dir = parent_dir(from_path);
        let joined = join_path(&from_dir, import_source);
        let normalized = normalize_path(&joined);

        if let Some(found) = try_resolve_file(&normalized, known_files) {
            return ResolvedImport::Internal(found);
        }

        return ResolvedImport::Unresolved(import_source.to_string());
    }

    ResolvedImport::External(import_source.to_string())
}

fn try_resolve_file(path: &str, known_files: &HashSet<String>) -> Option<String> {
    if known_files.contains(path) {
        return Some(path.to_string());
    }

    let extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
    for ext in &extensions {
        let with_ext = format!("{}{}", path, ext);
        if known_files.contains(&with_ext) {
            return Some(with_ext);
        }
    }

    for ext in &extensions {
        let index = format!("{}/index{}", path, ext);
        if known_files.contains(&index) {
            return Some(index);
        }
    }

    None
}

fn detect_cycles(edges: &mut [Edge], known_files: &HashSet<String>) {
    let mut adjacency: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, edge) in edges.iter().enumerate() {
        if known_files.contains(&edge.target) {
            adjacency.entry(edge.source.clone()).or_default().push(i);
        }
    }

    for file in known_files {
        let mut visited: HashSet<String> = HashSet::new();
        let mut stack: HashSet<String> = HashSet::new();
        let mut cycle_edges: Vec<usize> = Vec::new();

        dfs_cycle(file, &adjacency, edges, &mut visited, &mut stack, &mut cycle_edges);

        for idx in cycle_edges {
            if idx < edges.len() {
                edges[idx].circular = true;
            }
        }
    }
}

fn dfs_cycle(
    node: &str,
    adjacency: &HashMap<String, Vec<usize>>,
    edges: &[Edge],
    visited: &mut HashSet<String>,
    stack: &mut HashSet<String>,
    cycle_edges: &mut Vec<usize>,
) {
    if stack.contains(node) || visited.contains(node) {
        return;
    }

    visited.insert(node.to_string());
    stack.insert(node.to_string());

    if let Some(edge_indices) = adjacency.get(node) {
        for &idx in edge_indices {
            let target = &edges[idx].target;
            if stack.contains(target.as_str()) {
                cycle_edges.push(idx);
            } else if !visited.contains(target.as_str()) {
                dfs_cycle(target, adjacency, edges, visited, stack, cycle_edges);
            }
        }
    }

    stack.remove(node);
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_string()
}

fn parent_dir(path: &str) -> String {
    let normalized = normalize_path(path);
    match normalized.rfind('/') {
        Some(pos) => normalized[..pos].to_string(),
        None => String::new(),
    }
}

fn join_path(base: &str, relative: &str) -> String {
    let mut result: Vec<&str> = if base.is_empty() {
        vec![]
    } else {
        base.split('/').collect()
    };

    for segment in relative.split('/') {
        match segment {
            "." | "" => {}
            ".." => { result.pop(); }
            s => result.push(s),
        }
    }

    result.join("/")
}

fn detect_language(path: &str) -> &str {
    let lower = path.to_lowercase();
    if lower.ends_with(".tsx") { "tsx" }
    else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") { "ts" }
    else if lower.ends_with(".jsx") { "jsx" }
    else { "js" }
}
