//! Public data model shared with the JS side (serialized as camelCase).

use serde::{Deserialize, Serialize};

pub type NodeId = u32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct FileInput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct AnalyzerConfig {
    pub project_name: String,
    pub max_file_bytes: u32,
}

impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            project_name: "project".to_string(),
            max_file_bytes: 2_097_152,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct AddResult {
    pub accepted: u32,
    pub skipped: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum Language {
    Js,
    Jsx,
    Ts,
    Tsx,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum ImportKind {
    Static,
    Dynamic,
    Reexport,
    Require,
    TypeOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum NodeKind {
    Group,
    File,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum GroupKind {
    Folder,
    Package,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum UnresolvedReason {
    NotFound,
    Asset,
    UnknownAlias,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub enum SkipReason {
    TooLarge,
    NotIngestible,
}

/// Position is 1-based; column counts characters within the line.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct ParseError {
    pub message: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct UnresolvedImport {
    pub from: String,
    pub specifier: String,
    pub reason: UnresolvedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct SkippedFile {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct FileParseErrors {
    pub path: String,
    pub errors: Vec<ParseError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Issues {
    pub unresolved: Vec<UnresolvedImport>,
    pub skipped: Vec<SkippedFile>,
    pub parse_errors: Vec<FileParseErrors>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Summary {
    pub files: u32,
    pub edges: u32,
    pub cycles: u32,
    pub externals: u32,
    pub unresolved: u32,
    pub skipped: u32,
    pub parse_errors: u32,
    pub workspace_packages: u32,
    pub warnings: Vec<String>,
}

/// External nodes have `parent_id: None`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct VNode {
    pub id: NodeId,
    pub kind: NodeKind,
    pub label: String,
    pub path: String,
    pub size: u32,
    pub parent_id: Option<NodeId>,
    pub in_cycle: bool,
    pub expandable: bool,
    pub expanded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct VEdge {
    pub from: NodeId,
    pub to: NodeId,
    pub weight: u32,
    pub in_cycle: bool,
    pub type_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct VisibleGraph {
    pub nodes: Vec<VNode>,
    pub edges: Vec<VEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct DepRef {
    pub id: NodeId,
    pub path: String,
    pub kind: ImportKind,
    pub specifiers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct WeightedRef {
    pub id: NodeId,
    pub path: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct FileDetail {
    pub id: NodeId,
    pub path: String,
    pub language: Language,
    pub loc: u32,
    pub exports: Vec<String>,
    pub imports: Vec<DepRef>,
    pub imported_by: Vec<DepRef>,
    pub unresolved: Vec<UnresolvedImport>,
    pub cycle: Vec<String>,
    pub fan_in: u32,
    pub fan_out: u32,
    pub parse_errors: Vec<ParseError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct GroupDetail {
    pub id: NodeId,
    pub path: String,
    pub label: String,
    pub kind: GroupKind,
    pub file_count: u32,
    pub loc: u32,
    pub in_cycle: bool,
    pub top_outgoing: Vec<WeightedRef>,
    pub top_incoming: Vec<WeightedRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct ExternalDetail {
    pub id: NodeId,
    pub name: String,
    pub imported_by: Vec<DepRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub enum Detail {
    File(FileDetail),
    Group(GroupDetail),
    External(ExternalDetail),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
pub struct SearchHit {
    pub id: NodeId,
    pub kind: NodeKind,
    pub label: String,
    pub path: String,
    pub ancestors: Vec<NodeId>,
}
