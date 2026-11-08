mod graph;
mod parser;
mod types;

use wasm_bindgen::prelude::*;

use crate::graph::{build_graph, GraphConfig};
use crate::parser::parse_file;
use crate::types::FileEntry;

use std::collections::HashMap;

/// Parse a batch of files and return the dependency graph as JSON.
#[wasm_bindgen]
pub fn parse_project(files_json: &str) -> Result<String, JsValue> {
    let start = js_sys::Date::now();

    let files: Vec<FileEntry> = serde_json::from_str(files_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid input JSON: {}", e)))?;

    let config = extract_config(&files);

    let parsed: Vec<(String, crate::parser::ParseResult)> = files
        .iter()
        .filter(|f| is_parseable(&f.path))
        .map(|f| {
            let result = parse_file(&f.path, &f.content);
            (f.path.clone(), result)
        })
        .collect();

    let mut graph = build_graph(&parsed, &config);

    let elapsed = js_sys::Date::now() - start;
    graph.metadata.parse_time_ms = elapsed;

    serde_json::to_string(&graph)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Parse a single file and return its imports/exports as JSON.
#[wasm_bindgen]
pub fn parse_single_file(path: &str, content: &str) -> Result<String, JsValue> {
    let result = parse_file(path, content);

    let response = serde_json::json!({
        "path": path,
        "imports": result.imports,
        "exports": result.exports,
        "loc": result.loc,
        "errors": result.errors,
    });

    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

fn is_parseable(path: &str) -> bool {
    let lower = path.to_lowercase();
    let extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"];
    extensions.iter().any(|ext| lower.ends_with(ext))
}

fn extract_config(files: &[FileEntry]) -> GraphConfig {
    let mut config = GraphConfig::default();

    for file in files {
        let lower = file.path.to_lowercase();
        if lower.ends_with("tsconfig.json") || lower.ends_with("jsconfig.json") {
            if let Ok(tsconfig) = serde_json::from_str::<serde_json::Value>(&file.content) {
                if let Some(paths) = tsconfig
                    .get("compilerOptions")
                    .and_then(|co| co.get("paths"))
                    .and_then(|p| p.as_object())
                {
                    let base_url = tsconfig
                        .get("compilerOptions")
                        .and_then(|co| co.get("baseUrl"))
                        .and_then(|b| b.as_str())
                        .unwrap_or(".");

                    for (alias, targets) in paths {
                        if let Some(target) = targets.as_array().and_then(|a| a.first()) {
                            if let Some(target_str) = target.as_str() {
                                let clean_alias = alias.trim_end_matches('*');
                                let clean_target = target_str.trim_end_matches('*');
                                let resolved = if base_url == "." {
                                    clean_target.to_string()
                                } else {
                                    format!("{}/{}", base_url.trim_end_matches('/'), clean_target.trim_start_matches("./"))
                                };
                                config.path_aliases.insert(clean_alias.to_string(), resolved);
                            }
                        }
                    }
                }
            }
            break;
        }
    }

    config
}
