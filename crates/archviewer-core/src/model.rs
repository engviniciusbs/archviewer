//! Public data model shared with the JS side (serialized as camelCase).

use serde::{Deserialize, Serialize};

pub type NodeId = u32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct FileInput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
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
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct AddResult {
    pub accepted: u32,
    pub skipped: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum Language {
    Js,
    Jsx,
    Ts,
    Tsx,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum ImportKind {
    Static,
    Dynamic,
    Reexport,
    Require,
    TypeOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum NodeKind {
    Group,
    File,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum GroupKind {
    Folder,
    Package,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum UnresolvedReason {
    NotFound,
    Asset,
    UnknownAlias,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum SkipReason {
    TooLarge,
    NotIngestible,
}

/// What a warning is about; the UI turns it into a sentence in its own language.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum WarningCode {
    ExtendsNotFound,
    InvalidTsconfig,
    TsconfigReferenceNotFound,
    TsconfigIgnored,
    InvalidGlob,
    InvalidPackageJson,
}

/// `subject` is the path, glob or scope the warning refers to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct Warning {
    pub code: WarningCode,
    pub subject: String,
}

impl Warning {
    pub fn new(code: WarningCode, subject: impl Into<String>) -> Self {
        Self {
            code,
            subject: subject.into(),
        }
    }
}

/// Position is 1-based; column counts characters within the line.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct ParseError {
    pub message: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct UnresolvedImport {
    pub from: String,
    pub specifier: String,
    pub reason: UnresolvedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct SkippedFile {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct FileParseErrors {
    pub path: String,
    pub errors: Vec<ParseError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct Issues {
    pub unresolved: Vec<UnresolvedImport>,
    pub skipped: Vec<SkippedFile>,
    pub parse_errors: Vec<FileParseErrors>,
    pub warnings: Vec<Warning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct Summary {
    pub files: u32,
    pub edges: u32,
    pub cycles: u32,
    pub externals: u32,
    pub unresolved: u32,
    pub skipped: u32,
    pub parse_errors: u32,
    pub workspace_packages: u32,
    pub warnings: Vec<Warning>,
}

/// External nodes have `parent_id: None`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
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
    pub metrics: NodeMetrics,
}

/// Per-node numbers for the heatmap. For a collapsed group, fan-in and fan-out only count
/// files and externals outside the group; `loc` and `unused` add up the files inside.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct NodeMetrics {
    pub fan_in: u32,
    pub fan_out: u32,
    pub loc: u32,
    pub unused: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct VEdge {
    pub from: NodeId,
    pub to: NodeId,
    pub weight: u32,
    pub in_cycle: bool,
    pub type_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct VisibleGraph {
    pub nodes: Vec<VNode>,
    pub edges: Vec<VEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct DepRef {
    pub id: NodeId,
    pub path: String,
    pub kind: ImportKind,
    pub specifiers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct WeightedRef {
    pub id: NodeId,
    pub path: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
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
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct GroupDetail {
    pub id: NodeId,
    pub path: String,
    pub label: String,
    pub group_kind: GroupKind,
    pub file_count: u32,
    pub loc: u32,
    pub in_cycle: bool,
    pub top_outgoing: Vec<WeightedRef>,
    pub top_incoming: Vec<WeightedRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct ExternalDetail {
    pub id: NodeId,
    pub name: String,
    pub imported_by: Vec<DepRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub enum Detail {
    File(FileDetail),
    Group(GroupDetail),
    External(ExternalDetail),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct SearchHit {
    pub id: NodeId,
    pub kind: NodeKind,
    pub label: String,
    pub path: String,
    pub ancestors: Vec<NodeId>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(d: Detail, kind: &str) -> serde_json::Value {
        let json = serde_json::to_string(&d).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["kind"], kind);
        assert_eq!(serde_json::from_str::<Detail>(&json).unwrap(), d);
        v
    }

    #[test]
    fn detail_round_trips_with_tag() {
        let file = Detail::File(FileDetail {
            id: 1,
            path: "a.ts".into(),
            language: Language::Ts,
            loc: 3,
            exports: vec!["x".into()],
            imports: vec![],
            imported_by: vec![],
            unresolved: vec![],
            cycle: vec![],
            fan_in: 0,
            fan_out: 0,
            parse_errors: vec![],
        });
        round_trip(file, "file");

        let group = Detail::Group(GroupDetail {
            id: 2,
            path: "src".into(),
            label: "src".into(),
            group_kind: GroupKind::Folder,
            file_count: 1,
            loc: 3,
            in_cycle: false,
            top_outgoing: vec![],
            top_incoming: vec![],
        });
        let v = round_trip(group, "group");
        assert_eq!(v["groupKind"], "folder");

        let ext = Detail::External(ExternalDetail {
            id: 3,
            name: "react".into(),
            imported_by: vec![],
        });
        round_trip(ext, "external");
    }
}

/// One code file in the exported graph.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct ExportFile {
    pub path: String,
    pub language: Language,
    pub loc: u32,
    /// Name of the nearest workspace package above the file.
    pub package: Option<String>,
    pub in_cycle: bool,
    pub exports: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct ExportExternal {
    pub name: String,
}

/// `to` is a file path, or a package name when `external` is true.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct ExportEdge {
    pub from: String,
    pub to: String,
    pub kind: ImportKind,
    pub external: bool,
    pub specifiers: Vec<String>,
}

/// The whole file-level graph, keyed by paths and in a deterministic order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
pub struct GraphExport {
    pub schema: String,
    pub version: u32,
    pub project: String,
    pub summary: Summary,
    pub files: Vec<ExportFile>,
    pub externals: Vec<ExportExternal>,
    pub edges: Vec<ExportEdge>,
    pub cycles: Vec<Vec<String>>,
    pub unresolved: Vec<UnresolvedImport>,
    pub warnings: Vec<Warning>,
}
