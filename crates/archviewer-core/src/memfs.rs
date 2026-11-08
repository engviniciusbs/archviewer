//! In-memory file system for `oxc_resolver`. Code files exist with empty
//! content, configs carry their real content, and links appear as symlinks.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use oxc_resolver::{FileMetadata, FileSystem, ResolveError};

use crate::paths::normalize;

#[cfg(windows)]
const ROOT: &str = "C:\\vroot";
#[cfg(not(windows))]
const ROOT: &str = "/";

/// Virtual absolute path for a project-relative path.
pub fn to_virtual(rel: &str) -> PathBuf {
    let mut p = PathBuf::from(ROOT);
    for seg in normalize(rel).split('/').filter(|s| !s.is_empty()) {
        p.push(seg);
    }
    p
}

/// Project-relative path (`/` separated) for a virtual path, or `None` when
/// the path is outside the virtual root.
pub fn from_virtual(p: &Path) -> Option<String> {
    let rest = p.strip_prefix(ROOT).ok()?;
    let segs: Vec<&str> = rest
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect::<Option<_>>()?;
    Some(segs.join("/"))
}

#[derive(Debug, Default)]
struct Data {
    /// Files by relative path; code files have empty content.
    files: HashMap<String, String>,
    dirs: HashSet<String>,
    /// Relative link path -> relative target folder.
    links: HashMap<String, String>,
}

/// Cheap to clone: the data is shared, only the (small) per-clone content
/// overrides are copied.
#[derive(Debug, Default, Clone)]
pub struct MemoryFs {
    data: Arc<Data>,
    /// Replacement contents for existing files (e.g. sanitized tsconfigs).
    overrides: HashMap<String, String>,
}

fn add_ancestors(dirs: &mut HashSet<String>, rel: &str) {
    dirs.insert(String::new());
    let mut cur = rel;
    while let Some(i) = cur.rfind('/') {
        cur = &cur[..i];
        dirs.insert(cur.to_string());
    }
}

impl MemoryFs {
    pub fn new(
        code_paths: &HashSet<String>,
        configs: &HashMap<String, String>,
        links: &[(String, String)],
    ) -> Self {
        let mut fs = Data::default();
        for p in code_paths {
            let p = normalize(p);
            add_ancestors(&mut fs.dirs, &p);
            fs.files.insert(p, String::new());
        }
        for (p, content) in configs {
            let p = normalize(p);
            add_ancestors(&mut fs.dirs, &p);
            fs.files.insert(p, content.clone());
        }
        for (link, target) in links {
            let link = normalize(link);
            add_ancestors(&mut fs.dirs, &link);
            fs.links.insert(link, normalize(target));
        }
        MemoryFs {
            data: Arc::new(fs),
            overrides: HashMap::new(),
        }
    }

    /// Clone sharing the data, with `path` (an existing file) reading as `content`.
    pub fn with_override(&self, path: &str, content: String) -> Self {
        let mut fs = self.clone();
        fs.overrides.insert(normalize(path), content);
        fs
    }

    /// Relative path of `p`, with the longest link prefix replaced by its target.
    fn follow(&self, p: &Path) -> Option<String> {
        let mut rel = from_virtual(p)?;
        // Links may point through other links, so repeat (bounded against cycles).
        for _ in 0..16 {
            let hit = self.data.links.iter().find_map(|(link, target)| {
                if rel == *link {
                    Some(target.clone())
                } else {
                    rel.strip_prefix(link.as_str())
                        .and_then(|r| r.strip_prefix('/'))
                        .map(|r| format!("{target}/{r}"))
                }
            });
            match hit {
                Some(next) => rel = next,
                None => break,
            }
        }
        Some(rel)
    }
}

fn not_found(p: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::NotFound,
        format!("not found: {}", p.display()),
    )
}

impl FileSystem for MemoryFs {
    fn new() -> Self {
        MemoryFs::default()
    }

    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        self.read_to_string(path).map(String::into_bytes)
    }

    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        self.follow(path)
            .and_then(|r| {
                self.overrides
                    .get(&r)
                    .or_else(|| self.data.files.get(&r))
                    .cloned()
            })
            .ok_or_else(|| not_found(path))
    }

    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        let rel = self.follow(path).ok_or_else(|| not_found(path))?;
        if self.data.files.contains_key(&rel) {
            Ok(FileMetadata::new(true, false, false))
        } else if self.data.dirs.contains(&rel) {
            Ok(FileMetadata::new(false, true, false))
        } else {
            Err(not_found(path))
        }
    }

    fn symlink_metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        // lstat: the last component is not followed, intermediate links are.
        let rel = from_virtual(path).ok_or_else(|| not_found(path))?;
        if self.data.links.contains_key(&rel) {
            return Ok(FileMetadata::new(false, false, true));
        }
        self.metadata(path)
    }

    fn read_link(&self, path: &Path) -> Result<PathBuf, ResolveError> {
        from_virtual(path)
            .and_then(|rel| self.data.links.get(&rel))
            .map(|target| to_virtual(target))
            .ok_or_else(|| {
                ResolveError::from(io::Error::new(io::ErrorKind::InvalidInput, "not a symlink"))
            })
    }

    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        self.follow(path)
            .map(|r| to_virtual(&r))
            .ok_or_else(|| not_found(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    #[test]
    fn resolver_over_memfs() {
        let code: HashSet<String> = [
            "src/a.ts",
            "src/b/index.tsx",
            "src/lib/math.ts",
            "src/util.ts",
            "packages/ui/src/index.ts",
        ]
        .map(String::from)
        .into();
        let configs = HashMap::from([
            (
                "tsconfig.json".into(),
                r#"{ // jsonc
                "extends": "./tsconfig.base.json", }"#
                    .into(),
            ),
            (
                "tsconfig.base.json".into(),
                r#"{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#.into(),
            ),
            (
                "packages/ui/package.json".into(),
                r#"{"name":"@acme/ui","exports":{".":"./src/index.ts"}}"#.into(),
            ),
        ]);
        let fs = MemoryFs::new(
            &code,
            &configs,
            &[("node_modules/@acme/ui".into(), "packages/ui".into())],
        );
        let r = oxc_resolver::ResolverGeneric::new_with_file_system(
            fs,
            oxc_resolver::ResolveOptions {
                extensions: vec![".ts".into(), ".tsx".into(), ".js".into()],
                extension_alias: vec![(
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into()],
                )],
                condition_names: vec![
                    "types".into(),
                    "import".into(),
                    "require".into(),
                    "default".into(),
                ],
                tsconfig: Some(oxc_resolver::TsconfigDiscovery::Manual(
                    oxc_resolver::TsconfigOptions {
                        config_file: to_virtual("tsconfig.json"),
                        references: oxc_resolver::TsconfigReferences::Auto,
                    },
                )),
                ..Default::default()
            },
        );
        let dir = to_virtual("src");
        let ok = |s: &str| from_virtual(r.resolve(&dir, s).unwrap().path()).unwrap();
        assert_eq!(ok("./b"), "src/b/index.tsx");
        assert_eq!(ok("./util.js"), "src/util.ts");
        assert_eq!(ok("@lib/math"), "src/lib/math.ts");
        assert_eq!(ok("@acme/ui"), "packages/ui/src/index.ts");
        assert!(r.resolve(&dir, "./nope").is_err());
    }
}
