//! Path rules shared by the whole analysis core: normalization, what gets
//! ingested, and specifier classification.

pub const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    "coverage",
    "target",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
];

pub const CODE_EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

pub const ASSET_EXTENSIONS: &[&str] = &[
    "css", "scss", "sass", "less", "styl", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif",
    "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm", "mp3", "wav", "json", "md",
    "mdx", "html", "txt", "wasm", "graphql", "gql", "yaml", "yml",
];

/// Project-relative path with `/` separators, no `./` and no leading `/`.
pub fn normalize(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn extension(name: &str) -> Option<String> {
    name.rfind('.').map(|i| name[i + 1..].to_ascii_lowercase())
}

fn in_ignored_dir(path: &str) -> bool {
    let mut segments: Vec<&str> = path.split('/').collect();
    segments.pop();
    segments
        .iter()
        .any(|s| IGNORED_DIRS.contains(s) || s.starts_with('.'))
}

pub fn is_code(path: &str) -> bool {
    extension(file_name(path)).is_some_and(|e| CODE_EXTENSIONS.contains(&e.as_str()))
}

pub fn is_config(path: &str) -> bool {
    let name = file_name(path);
    name == "package.json"
        || name == "pnpm-workspace.yaml"
        || name == "index.html"
        || ((name.starts_with("tsconfig") || name.starts_with("jsconfig"))
            && name.ends_with(".json"))
}

/// Code or config file that is not inside an ignored folder.
pub fn is_ingestible(path: &str) -> bool {
    (is_code(path) || is_config(path)) && !in_ignored_dir(path)
}

/// True when the specifier points at a non-code asset (after removing `?query`).
pub fn is_asset_specifier(spec: &str) -> bool {
    let bare = spec.split(['?', '#']).next().unwrap_or(spec);
    extension(file_name(bare)).is_some_and(|e| ASSET_EXTENSIONS.contains(&e.as_str()))
}

/// Package part of a bare specifier: `@a/b/c` -> `@a/b`, `lodash/fp` -> `lodash`.
pub fn package_name(spec: &str) -> String {
    if spec.starts_with("node:") {
        return spec.to_string();
    }
    let take = if spec.starts_with('@') { 2 } else { 1 };
    spec.split('/').take(take).collect::<Vec<_>>().join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes() {
        assert_eq!(normalize(".\\src\\a.ts"), "src/a.ts");
        assert_eq!(normalize("/src/a.ts"), "src/a.ts");
    }
    #[test]
    fn ingestible() {
        assert!(is_ingestible("src/a.tsx"));
        assert!(is_ingestible("tsconfig.base.json"));
        assert!(is_ingestible("packages/ui/package.json"));
        assert!(is_ingestible("pnpm-workspace.yaml"));
        assert!(!is_ingestible("node_modules/x/index.js"));
        assert!(!is_ingestible(".github/a.js"));
        assert!(!is_ingestible("src/a.css"));
        assert!(!is_ingestible("dist/a.js"));
    }
    #[test]
    fn assets() {
        assert!(is_asset_specifier("./a.module.css"));
        assert!(is_asset_specifier("./icon.svg?react"));
        assert!(!is_asset_specifier("./a"));
    }
    #[test]
    fn package_names() {
        assert_eq!(package_name("@a/b/c"), "@a/b");
        assert_eq!(package_name("lodash/fp"), "lodash");
        assert_eq!(package_name("node:fs"), "node:fs");
    }
}
