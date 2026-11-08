use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub language: String,
    pub exports: Vec<String>,
    pub loc: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    File,
    External,
    Unresolved,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub imports: Vec<String>,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
    pub circular: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeType {
    Named,
    Default,
    Namespace,
    Commonjs,
    Dynamic,
    SideEffect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub total_files: u32,
    pub total_edges: u32,
    pub parse_time_ms: f64,
    pub errors: Vec<ParseError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseError {
    pub file: String,
    pub message: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportInfo {
    pub source: String,
    pub specifiers: Vec<String>,
    pub import_type: EdgeType,
}
