use std::path::{Path, PathBuf};

use archviewer_core::model::FileInput;
use archviewer_core::paths::is_ingestible;

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            collect(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// Loads `fixtures/<name>`: ingestible files only, paths relative to the fixture, sorted.
/// CRLF is normalized to LF so content (and line numbers) never depend on git autocrlf.
pub fn load_fixture(name: &str) -> Vec<FileInput> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name);
    let mut files = Vec::new();
    collect(&root, &mut files);
    let mut out: Vec<FileInput> = files
        .into_iter()
        .filter_map(|p| {
            let rel = p
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if !is_ingestible(&rel) {
                return None;
            }
            let content = std::fs::read_to_string(&p).unwrap().replace("\r\n", "\n");
            Some(FileInput { path: rel, content })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}
