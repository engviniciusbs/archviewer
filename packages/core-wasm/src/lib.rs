//! wasm-bindgen wrapper around `archviewer-core`.
//!
//! Types come from `archviewer_core::model` (TypeScript declarations generated
//! by `tsify`); this crate only adds the JS-facing `Analyzer` class and helpers.
//! Values cross the boundary through `tsify::Ts<T>` (serde-based, no leaks on
//! (de)serialization failure) and failures surface as thrown JS `Error`s.

use archviewer_core::model::{
    AddResult, AnalyzerConfig, Detail, FileInput, Issues, SearchHit, Summary, VisibleGraph,
};
use archviewer_core::paths;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// Installs the panic hook so Rust panics show up in the JS console.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))
}

fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(value).map_err(|e| JsError::new(&e.to_string()))
}

/// Whether a path would be ingested; accepts `./` prefixes and `\` separators.
#[wasm_bindgen(js_name = isIngestible)]
pub fn is_ingestible(path: &str) -> bool {
    paths::is_ingestible(&paths::normalize(path))
}

#[wasm_bindgen(js_name = ignoredDirs)]
pub fn ignored_dirs() -> Vec<String> {
    paths::IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
}

#[wasm_bindgen]
pub struct Analyzer(archviewer_core::analyzer::Analyzer);

#[wasm_bindgen]
impl Analyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(config: Ts<AnalyzerConfig>) -> Result<Analyzer, JsError> {
        Ok(Analyzer(archviewer_core::analyzer::Analyzer::new(
            config.to_rust()?,
        )))
    }

    #[wasm_bindgen(js_name = addFiles)]
    pub fn add_files(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "FileInput[]")] files: JsValue,
    ) -> Result<Ts<AddResult>, JsError> {
        let files: Vec<FileInput> = from_js(files)?;
        Ok(self.0.add_files(files)?.into_ts()?)
    }

    pub fn finish(&mut self) -> Result<Ts<Summary>, JsError> {
        Ok(self.0.finish()?.into_ts()?)
    }

    #[wasm_bindgen(js_name = defaultExpansion, unchecked_return_type = "number[]")]
    pub fn default_expansion(&self) -> Result<JsValue, JsError> {
        to_js(&self.0.default_expansion())
    }

    pub fn view(
        &self,
        #[wasm_bindgen(unchecked_param_type = "number[]")] expanded: JsValue,
    ) -> Result<Ts<VisibleGraph>, JsError> {
        let expanded: Vec<u32> = from_js(expanded)?;
        Ok(self.0.view(&expanded).into_ts()?)
    }

    pub fn detail(&self, id: u32) -> Result<Option<Ts<Detail>>, JsError> {
        Ok(self.0.detail(id).map(|d| d.into_ts()).transpose()?)
    }

    pub fn issues(&self) -> Result<Ts<Issues>, JsError> {
        Ok(self.0.issues().into_ts()?)
    }

    #[wasm_bindgen(unchecked_return_type = "SearchHit[]")]
    pub fn find(&self, query: &str, limit: u32) -> Result<JsValue, JsError> {
        let hits: Vec<SearchHit> = self.0.find(query, limit as usize);
        to_js(&hits)
    }
}
