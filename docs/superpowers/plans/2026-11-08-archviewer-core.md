# ArchViewer Core (Plano 1 de 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o núcleo de análise em Rust (`archviewer-core`) e o wrapper WASM (`core-wasm`). Ele recebe arquivos de um projeto JS/TS e devolve o grafo resolvido, hierárquico e analisado, testável sem nenhuma UI.

**Architecture:** O crate Rust puro faz parse (OXC), resolução (`oxc_resolver` sobre um sistema de arquivos em memória), ciclos (Tarjan iterativo), hierarquia de pastas e pacotes e agregação de visões. O `core-wasm` só expõe um `Analyzer` com estado via `wasm-bindgen`, com tipos TS gerados por `tsify-next`. O Plano 2 (app web) consome exclusivamente a API do Task 8.

**Tech Stack:** Rust (edition 2021, rustc 1.99), `oxc_parser`/`oxc_ast`/`oxc_allocator`/`oxc_span`/`oxc_ast_visit`, `oxc_resolver`, `json-strip-comments`, `globset`, `serde`/`serde_json`, `insta` (feature `json`), `wasm-bindgen` + `wasm-bindgen-cli`, `tsify-next`, `serde-wasm-bindgen`, `console_error_panic_hook`, Vitest (Node), pnpm 9.15, Turborepo.

**Spec:** `docs/superpowers/specs/2026-11-08-archviewer-replan-design.md` (seções 3, 4, 6, 7 e 10)

## Global Constraints

- **Caminhos:**
  - Sempre relativos à raiz do projeto, com `/` como separador, sem `./` nem `/` iniciais (ex.: `src/utils/helpers.ts`).
  - A entrada pode trazer `\` ou `./`, e é normalizada.
- **Saída para o JS:** campos em camelCase; enums em camelCase (`typeOnly`, `notFound`, `unknownAlias`, `tooLarge`).
- **Ids:** todo nó (grupo, arquivo ou externo) tem um `NodeId = u32` num único espaço de ids. O grupo raiz é sempre o id `0`.
- **Tamanho máximo de arquivo:** `2_097_152` bytes (2 MB). Acima disso, o arquivo é pulado com motivo `tooLarge`.
- **Dependências do core:** o `archviewer-core` não depende de crates WASM. `tsify-next` e `wasm-bindgen` entram só sob a feature `wasm`.
- **Nunca panic na API pública:** id inválido devolve `None` ou vazio; uso fora de ordem devolve `Err`.
- **Conteúdo-fonte:** não fica guardado depois do parse. Só o conteúdo de arquivos de configuração é mantido.
- **Arestas `typeOnly`:** não participam da detecção de ciclos, porque são apagadas em runtime. Elas continuam no grafo e nas visões.
- **Pastas ignoradas** (qualquer segmento do caminho): `node_modules .git dist build out coverage target .next .nuxt .svelte-kit .turbo .cache` e qualquer pasta iniciada por `.`.
- **Extensões de código:** `.ts .tsx .mts .cts .js .jsx .mjs .cjs`.
- **Arquivos de configuração aceitos:** `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `jsconfig*.json`.
- **Extensões de asset** (motivo `asset`), verificadas depois de remover `?query`: `css scss sass less styl svg png jpg jpeg gif webp avif ico bmp woff woff2 ttf otf eot mp4 webm mp3 wav json md mdx html txt wasm graphql gql yaml yml`.
- **Versões de crates:**
  - Adicionadas com `cargo add` na versão atual e fixadas no `Cargo.lock` raiz, que vai para o commit.
  - `wasm-bindgen` com versão exata (`=x.y.z`), igual à do `wasm-bindgen-cli` instalado.
- **Snapshots:** convenção do `insta`, em `crates/archviewer-core/tests/snapshots/`. Isso substitui o "`expected.json` por fixture" da spec, com o mesmo propósito.

## Review Focus

1. **Caminhos com `\` vindos do Windows** (`src\\a.ts`) e imports entre eles: devem virar `src/a.ts` e resolver normalmente. Teste no Task 4.
2. **O mesmo caminho enviado em dois lotes:** o último vence, sem nó duplicado. Teste no Task 4.
3. **Cadeia de imports muito longa** (50.000 arquivos em fila): o Tarjan não pode estourar a pilha, o que é crítico em WASM. Teste no Task 4.
4. **`view`/`detail`/`find` com ids inexistentes ou antes do `finish()`** (corrida na UI): devolvem vazio ou `None`, sem panic. Testes nos Tasks 5 e 6.
5. **Projeto vazio** (nenhum arquivo de código): o `finish()` devolve zeros, `defaultExpansion = [0]` e `view` vazio. Teste no Task 5.

---

## File Structure

```
Cargo.toml                                  # workspace: crates/archviewer-core, packages/core-wasm
crates/archviewer-core/
  Cargo.toml                                # feature "wasm" = [tsify-next, wasm-bindgen]
  src/lib.rs                                # mods + re-exports públicos
  src/paths.rs                              # normalize, is_ingestible, is_code, is_config, asset, package_name
  src/model.rs                              # todos os tipos públicos (contrato)
  src/parse.rs                              # parse_source → ParsedFile
  src/memfs.rs                              # MemoryFs: impl oxc_resolver::FileSystem
  src/workspace.rs                          # detect_workspaces
  src/resolve.rs                            # ResolverSet → Resolution
  src/cycles.rs                             # strongly_connected (Tarjan iterativo)
  src/graph.rs                              # Graph interno + build (hierarquia, arestas, ciclos)
  src/analyzer.rs                           # Analyzer (API pública com estado)
  src/view.rs                               # default_expansion, view
  src/detail.rs                             # detail, find
  tests/common/mod.rs                       # load_fixture(name) -> Vec<FileInput>
  tests/fixtures.rs                         # snapshots insta por fixture
  tests/perf.rs                             # 20k arquivos, #[ignore]
packages/core-wasm/
  Cargo.toml, src/lib.rs                    # wrapper wasm-bindgen
  package.json, scripts/build.mjs           # cargo build wasm32 + wasm-bindgen --target web
  test/analyzer.test.ts                     # Vitest no Node contra o .wasm real
fixtures/{tsconfig-paths,monorepo-pnpm,commonjs,broken}/   # novas
.github/workflows/core.yml                  # cargo test + vitest do core-wasm
```

Remover: `packages/wasm-parser/` inteiro (incluindo o `Cargo.lock` não rastreado).

---

### Task 1: Workspace Cargo, `paths.rs` e spike do `MemoryFs` com `oxc_resolver`

Este task é o **gate de risco** da spec (seção 10). Se o `oxc_resolver` não funcionar sobre o `MemoryFs` tanto no host (Windows) quanto no build `wasm32`, pare e reporte antes de seguir.

**Files:**
- Create: `Cargo.toml`, `crates/archviewer-core/Cargo.toml`, `crates/archviewer-core/src/{lib.rs,paths.rs,memfs.rs}`
- Delete: `packages/wasm-parser/`
- Modify: `.gitignore` (adicionar `/target/`)

**Interfaces:**
- Produces (`paths.rs`):
  - `pub const IGNORED_DIRS: &[&str]`
  - `pub const CODE_EXTENSIONS: &[&str]`
  - `pub const ASSET_EXTENSIONS: &[&str]`
  - `pub fn normalize(path: &str) -> String`
  - `pub fn is_code(path: &str) -> bool`
  - `pub fn is_config(path: &str) -> bool`
  - `pub fn is_ingestible(path: &str) -> bool` (código ou config, fora de pasta ignorada)
  - `pub fn is_asset_specifier(spec: &str) -> bool`
  - `pub fn package_name(spec: &str) -> String` (`@a/b/c`→`@a/b`, `lodash/fp`→`lodash`, `node:fs`→`node:fs`)
- Produces (`memfs.rs`):
  - `pub struct MemoryFs`
  - `MemoryFs::new(code_paths: &HashSet<String>, configs: &HashMap<String, String>, links: &[(String, String)]) -> Self`. `links` são pares (caminho virtual do link, pasta alvo), ex.: `("node_modules/@acme/ui", "packages/ui")`.
  - `pub fn to_virtual(rel: &str) -> PathBuf`
  - `pub fn from_virtual(p: &Path) -> Option<String>`
  - A raiz virtual é `"/"`, e `"C:\\vroot"` sob `cfg(windows)`. Pastas são derivadas dos caminhos de arquivo. Arquivos de código existem com conteúdo vazio; configs têm o conteúdo real.
  - Implementa `oxc_resolver::FileSystem` (na versão fixada: `read_to_string`, `metadata`, `symlink_metadata`, `read_link`; conferir no docs.rs). Os links aparecem como symlink para a pasta alvo.

- [ ] **Step 1: Criar o workspace.** `Cargo.toml` raiz com `[workspace] members = ["crates/archviewer-core"]`, `resolver = "2"` e `[profile.release] opt-level = "s", lto = true`. Criar o crate e rodar `cargo add oxc_resolver serde --features serde/derive serde_json json-strip-comments globset`. Remover `packages/wasm-parser/`.

- [ ] **Step 2: Escrever os testes que falham** em `paths.rs` (`#[cfg(test)]`):

```rust
#[test] fn normalizes() { assert_eq!(normalize(".\\src\\a.ts"), "src/a.ts"); assert_eq!(normalize("/src/a.ts"), "src/a.ts"); }
#[test] fn ingestible() {
    assert!(is_ingestible("src/a.tsx")); assert!(is_ingestible("tsconfig.base.json"));
    assert!(is_ingestible("packages/ui/package.json")); assert!(is_ingestible("pnpm-workspace.yaml"));
    assert!(!is_ingestible("node_modules/x/index.js")); assert!(!is_ingestible(".github/a.js"));
    assert!(!is_ingestible("src/a.css")); assert!(!is_ingestible("dist/a.js"));
}
#[test] fn assets() { assert!(is_asset_specifier("./a.module.css")); assert!(is_asset_specifier("./icon.svg?react")); assert!(!is_asset_specifier("./a")); }
#[test] fn package_names() { assert_eq!(package_name("@a/b/c"), "@a/b"); assert_eq!(package_name("lodash/fp"), "lodash"); assert_eq!(package_name("node:fs"), "node:fs"); }
```

E em `memfs.rs`, um teste de integração com o `oxc_resolver` (o próprio spike):

```rust
#[test] fn resolver_over_memfs() {
    let code: HashSet<String> = ["src/a.ts","src/b/index.tsx","src/lib/math.ts","src/util.ts","packages/ui/src/index.ts"].map(String::from).into();
    let configs = HashMap::from([
        ("tsconfig.json".into(), r#"{ // jsonc
            "extends": "./tsconfig.base.json", }"#.into()),
        ("tsconfig.base.json".into(), r#"{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#.into()),
        ("packages/ui/package.json".into(), r#"{"name":"@acme/ui","exports":{".":"./src/index.ts"}}"#.into()),
    ]);
    let fs = MemoryFs::new(&code, &configs, &[("node_modules/@acme/ui".into(), "packages/ui".into())]);
    let r = oxc_resolver::ResolverGeneric::new_with_file_system(fs, oxc_resolver::ResolveOptions {
        extensions: vec![".ts".into(), ".tsx".into(), ".js".into()],
        extension_alias: vec![(".js".into(), vec![".ts".into(), ".tsx".into(), ".js".into()])],
        condition_names: vec!["types".into(), "import".into(), "require".into(), "default".into()],
        tsconfig: Some(oxc_resolver::TsconfigOptions { config_file: to_virtual("tsconfig.json"), references: oxc_resolver::TsconfigReferences::Auto }),
        ..Default::default()
    });
    let dir = to_virtual("src");
    let ok = |s: &str| from_virtual(r.resolve(&dir, s).unwrap().path()).unwrap();
    assert_eq!(ok("./b"), "src/b/index.tsx");
    assert_eq!(ok("./util.js"), "src/util.ts");
    assert_eq!(ok("@lib/math"), "src/lib/math.ts");
    assert_eq!(ok("@acme/ui"), "packages/ui/src/index.ts");
    assert!(r.resolve(&dir, "./nope").is_err());
}
```

Os nomes de campos do `ResolveOptions` e do `TsconfigOptions` podem variar entre versões. Ajuste à versão fixada, sem mudar as asserções.

- [ ] **Step 3: Rodar e ver falhar.** `cargo test -p archviewer-core`. Esperado: erro de compilação, porque as funções ainda não existem.

- [ ] **Step 4: Implementar** `paths.rs` e `memfs.rs`.

- [ ] **Step 5: Rodar e ver passar.** `cargo test -p archviewer-core`. Esperado: 5 testes passando.

- [ ] **Step 6: Validar o build WASM.** `rustup target add wasm32-unknown-unknown && cargo build -p archviewer-core --target wasm32-unknown-unknown --release`. Esperado: compila. Se falhar (por exemplo, o `oxc_resolver` puxando I/O nativo), **pare e reporte**.

- [ ] **Step 7: Commit.**

```bash
git add Cargo.toml Cargo.lock .gitignore crates/ && git rm -r -q packages/wasm-parser
git commit -m "feat(core): cargo workspace, path rules and in-memory fs for oxc_resolver"
```

---

### Task 2: Modelo público e extração de imports/exports (`model.rs`, `parse.rs`)

**Files:**
- Create: `crates/archviewer-core/src/{model.rs,parse.rs}`
- Modify: `lib.rs`

**Interfaces:**
- Produces (`model.rs`). Todos com `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`, `#[serde(rename_all = "camelCase")]` e `#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]`; os que saem para o JS levam também `#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]`:
  - **Básicos:**
    - `pub type NodeId = u32;`
    - `FileInput { path: String, content: String }`
    - `AnalyzerConfig { project_name: String, max_file_bytes: u32 }` (`Default`: `"project"`, `2_097_152`)
    - `AddResult { accepted: u32, skipped: u32 }`
  - **Enums:**
    - `Language { Js, Jsx, Ts, Tsx }`
    - `ImportKind { Static, Dynamic, Reexport, Require, TypeOnly }`
    - `NodeKind { Group, File, External }`
    - `GroupKind { Folder, Package }`
    - `UnresolvedReason { NotFound, Asset, UnknownAlias }`
    - `SkipReason { TooLarge, NotIngestible }`
  - **Erros e problemas:**
    - `ParseError { message: String, line: u32, column: u32 }` (1-based)
    - `UnresolvedImport { from: String, specifier: String, reason: UnresolvedReason }`
    - `SkippedFile { path: String, reason: SkipReason }`
    - `FileParseErrors { path: String, errors: Vec<ParseError> }`
    - `Issues { unresolved: Vec<UnresolvedImport>, skipped: Vec<SkippedFile>, parse_errors: Vec<FileParseErrors>, warnings: Vec<String> }`
  - **Resumo:** `Summary { files: u32, edges: u32, cycles: u32, externals: u32, unresolved: u32, skipped: u32, parse_errors: u32, workspace_packages: u32, warnings: Vec<String> }`
  - **Visão:**
    - `VNode { id: NodeId, kind: NodeKind, label: String, path: String, size: u32, parent_id: Option<NodeId>, in_cycle: bool, expandable: bool, expanded: bool }` (externos têm `parent_id: None`)
    - `VEdge { from: NodeId, to: NodeId, weight: u32, in_cycle: bool, type_only: bool }`
    - `VisibleGraph { nodes: Vec<VNode>, edges: Vec<VEdge> }`
  - **Detalhes:**
    - `DepRef { id: NodeId, path: String, kind: ImportKind, specifiers: Vec<String> }`
    - `WeightedRef { id: NodeId, path: String, weight: u32 }`
    - `FileDetail { id, path, language: Language, loc: u32, exports: Vec<String>, imports: Vec<DepRef>, imported_by: Vec<DepRef>, unresolved: Vec<UnresolvedImport>, cycle: Vec<String>, fan_in: u32, fan_out: u32, parse_errors: Vec<ParseError> }`
    - `GroupDetail { id, path, label, group_kind: GroupKind, file_count: u32, loc: u32, in_cycle: bool, top_outgoing: Vec<WeightedRef>, top_incoming: Vec<WeightedRef> }`
    - `ExternalDetail { id, name: String, imported_by: Vec<DepRef> }`
    - `Detail` = enum com `#[serde(tag = "kind", rename_all = "camelCase")]`: `File(FileDetail) | Group(GroupDetail) | External(ExternalDetail)`
  - **Busca:** `SearchHit { id: NodeId, kind: NodeKind, label: String, path: String, ancestors: Vec<NodeId> }`
- Produces (`parse.rs`):
  - `pub struct RawImport { pub specifier: String, pub kind: ImportKind, pub specifiers: Vec<String> }`
  - `pub struct ParsedFile { pub language: Language, pub loc: u32, pub imports: Vec<RawImport>, pub exports: Vec<String>, pub errors: Vec<ParseError> }`
  - `pub fn parse_source(path: &str, source: &str) -> ParsedFile`

**Regras de extração** (o visitor percorre a AST inteira, não só o topo, com `oxc_ast_visit::Visit`; se a versão fixada ainda expõe `oxc_ast::Visit`, use esse):

| Construção | kind | specifiers / export |
|---|---|---|
| `import {a as b, c} from 'x'` | `Static` | `["a","c"]` (nome importado, não o local) |
| `import d from 'x'` / `import * as n from 'x'` / `import 'x'` | `Static` | `["default"]` / `["*"]` / `[]` |
| `import type {T} from 'x'`, ou `import {type T} from 'x'` (todos de tipo) | `TypeOnly` | `["T"]` |
| `export {a} from 'x'` / `export * from 'x'` / `export * as ns from 'x'` | `Reexport` (`TypeOnly` se `export type`) | `["a"]` / `["*"]` / `["*"]`; exports: `a` / `*` / `ns` |
| `import('x')` com literal string, em qualquer lugar | `Dynamic` | `[]` |
| `require('x')` em qualquer lugar, ou `import x = require('x')` | `Require` | `[]` |
| `export const/function/class/type/interface/enum N`, `export {N}` | — | exports: `N` |
| `export default`, `module.exports =` | — | exports: `default` |
| `exports.n =`, `module.exports.n =` | — | exports: `n` |

- `language`: `.tsx`→`Tsx`, `.jsx`→`Jsx`, `.ts/.mts/.cts`→`Ts`, demais→`Js`.
- Source type: `SourceType::from_path`.
- `loc` = `source.lines().count()`.
- `errors`: um por diagnóstico do OXC, usando o offset do primeiro label para calcular linha e coluna (1-based).

- [ ] **Step 1: Escrever os testes que falham** em `parse.rs`:

```rust
fn kinds(src: &str) -> Vec<(String, ImportKind, Vec<String>)> {
    parse_source("a.ts", src).imports.into_iter().map(|i| (i.specifier, i.kind, i.specifiers)).collect()
}
#[test] fn static_named_default_namespace() {
    let k = kinds("import {a as b, c} from './x'; import d from './y'; import * as n from './z'; import './w';");
    assert_eq!(k[0], ("./x".into(), ImportKind::Static, vec!["a".into(), "c".into()]));
    assert_eq!(k[1].2, vec!["default"]); assert_eq!(k[2].2, vec!["*"]); assert!(k[3].2.is_empty());
}
#[test] fn type_only() {
    let k = kinds("import type {T} from './t'; import {type U} from './u'; import {type V, w} from './v';");
    assert_eq!(k[0].1, ImportKind::TypeOnly); assert_eq!(k[1].1, ImportKind::TypeOnly); assert_eq!(k[2].1, ImportKind::Static);
}
#[test] fn reexports_and_exports() {
    let p = parse_source("a.ts", "export {a} from './a'; export * from './b'; export * as ns from './c'; export const x = 1; export default 2;");
    assert!(p.imports.iter().all(|i| i.kind == ImportKind::Reexport));
    assert_eq!(p.exports, vec!["a", "*", "ns", "x", "default"]);
}
#[test] fn nested_dynamic_and_require() {
    let k = kinds("function f(){ const m = require('./r'); return import('./d'); } import x = require('./e');");
    assert_eq!(k.iter().map(|i| i.1.clone()).collect::<Vec<_>>(), vec![ImportKind::Require, ImportKind::Dynamic, ImportKind::Require]);
}
#[test] fn commonjs_exports() {
    let p = parse_source("a.js", "exports.x = 1; module.exports.y = 2; module.exports = {};");
    assert_eq!(p.exports, vec!["x", "y", "default"]);
}
#[test] fn syntax_error_has_position() {
    let p = parse_source("bad.ts", "const ok = 1;\nexport const x = ;\n");
    assert!(!p.errors.is_empty()); assert_eq!(p.errors[0].line, 2); assert_eq!(p.loc, 2);
}
#[test] fn languages() { assert_eq!(parse_source("a.tsx", "").language, Language::Tsx); assert_eq!(parse_source("a.cjs", "").language, Language::Js); }
```

- [ ] **Step 2: Rodar e ver falhar.** Primeiro `cargo add oxc_parser oxc_ast oxc_allocator oxc_span oxc_ast_visit` (todos na mesma versão), depois `cargo test -p archviewer-core parse`. Esperado: erro de compilação.

- [ ] **Step 3: Implementar** `model.rs` (só os tipos) e `parse.rs` seguindo a tabela acima. A feature `wasm` no `Cargo.toml` fica vazia por enquanto, preenchida no Task 8.

- [ ] **Step 4: Rodar e ver passar.** `cargo test -p archviewer-core parse`. Esperado: 7 testes passando.

- [ ] **Step 5: Commit.** `git commit -am "feat(core): public model and import/export extraction"` (antes, adicionar os arquivos novos com `git add`).

---

### Task 3: Workspaces e resolução (`workspace.rs`, `resolve.rs`)

**Files:**
- Create: `crates/archviewer-core/src/{workspace.rs,resolve.rs}`

**Interfaces:**
- Consumes: `MemoryFs`, `to_virtual`/`from_virtual`, `is_asset_specifier` e `package_name` (Task 1); `UnresolvedReason` (Task 2).
- Produces:
  - `pub struct WorkspacePackage { pub name: String, pub dir: String }`
  - `pub fn detect_workspaces(configs: &HashMap<String, String>, dirs: &BTreeSet<String>) -> (Vec<WorkspacePackage>, Vec<String>)`. O segundo valor são os avisos.
  - `pub enum Resolution { Internal(String), External(String), Unresolved(UnresolvedReason) }`
  - `pub struct ResolverSet`
  - `ResolverSet::build(code: &HashSet<String>, configs: &HashMap<String, String>, packages: &[WorkspacePackage]) -> (ResolverSet, Vec<String>)`
  - `pub fn resolve(&self, from_file: &str, specifier: &str) -> Resolution`

**Regras:**

1. **Workspaces.** Os globs vêm de:
   - `pnpm-workspace.yaml` na raiz: lista sob `packages:`, com itens `- 'glob'`, `- "glob"` ou `- glob`. Parse por linhas, sem dependência de YAML.
   - `workspaces` no `package.json` raiz, como array ou como `{ "packages": [...] }`.

   Cada pasta em `dirs` que casa com um glob (`globset`) e tem `package.json` com `name` vira um `WorkspacePackage`. Globs começando com `!` excluem. Um `package.json` inválido gera o aviso `package.json inválido: <path>`.
2. **Ordem de classificação** em `resolve`:
   1. Specifier de asset → `Unresolved(Asset)`.
   2. Tenta o resolver do escopo do arquivo. Sucesso para um caminho em `code` → `Internal`.
   3. Falha com specifier relativo ou absoluto → `Unresolved(NotFound)`.
   4. Falha com specifier "bare" cujo `package_name` é um pacote do workspace → **fallback de fonte**: tenta `<dir>/src/index.{ts,tsx,js,jsx}` e depois `<dir>/index.{ts,tsx,js,jsx}`. O primeiro existente → `Internal`; nenhum → `Unresolved(NotFound)`.
   5. Falha com bare que casa com o prefixo de uma chave de `compilerOptions.paths` do tsconfig do escopo (a chave sem o `*` final), ou que começa com `@/` ou `~/` → `Unresolved(UnknownAlias)`.
   6. Qualquer outro bare → `External(package_name(spec))`.
3. **Escopo do tsconfig:** o `tsconfig.json` ou `jsconfig.json` mais próximo subindo a partir do arquivo. Há um resolver por escopo, criado sob demanda e guardado em cache. Antes de usar um tsconfig, ele é validado: remover comentários (`json-strip-comments`), fazer o parse com `serde_json` e conferir se o alvo de `extends` relativo existe. Se o tsconfig for inválido, o escopo usa um resolver sem tsconfig e gera o aviso `tsconfig inválido: <path>`. Se o `extends` apontar para um pacote, como `@tsconfig/...`, não há aviso: seus aliases são simplesmente ignorados.
4. **Opções do resolver:**
   - `extensions = [.ts .tsx .mts .cts .js .jsx .mjs .cjs]`
   - `extension_alias`: `.js`→`[.ts .tsx .js]`, `.mjs`→`[.mts .mjs]`, `.cjs`→`[.cts .cjs]`
   - `condition_names = [types import require default]`
   - links do `MemoryFs`: `node_modules/<name>` → `<dir>` para cada pacote do workspace

- [ ] **Step 1: Escrever os testes que falham** em `resolve.rs`, com um helper `fn set(code: &[&str], configs: &[(&str, &str)]) -> ResolverSet` que roda `detect_workspaces` + `build`:

```rust
#[test] fn classifies() {
    let r = set(&["src/a.ts","src/b.ts","src/lib/m.ts"], &[("tsconfig.json", r#"{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}"#)]);
    assert_eq!(r.resolve("src/a.ts", "./b"), Resolution::Internal("src/b.ts".into()));
    assert_eq!(r.resolve("src/a.ts", "@lib/m"), Resolution::Internal("src/lib/m.ts".into()));
    assert_eq!(r.resolve("src/a.ts", "@lib/nope"), Resolution::Unresolved(UnresolvedReason::UnknownAlias));
    assert_eq!(r.resolve("src/a.ts", "~/x"), Resolution::Unresolved(UnresolvedReason::UnknownAlias));
    assert_eq!(r.resolve("src/a.ts", "./x.module.css"), Resolution::Unresolved(UnresolvedReason::Asset));
    assert_eq!(r.resolve("src/a.ts", "./missing"), Resolution::Unresolved(UnresolvedReason::NotFound));
    assert_eq!(r.resolve("src/a.ts", "@scope/pkg/deep"), Resolution::External("@scope/pkg".into()));
    assert_eq!(r.resolve("src/a.ts", "node:fs"), Resolution::External("node:fs".into()));
}
#[test] fn case_sensitive() {
    let r = set(&["src/a.ts","src/button.tsx"], &[]);
    assert_eq!(r.resolve("src/a.ts", "./Button"), Resolution::Unresolved(UnresolvedReason::NotFound));
}
#[test] fn workspace_packages_and_fallback() {
    let r = set(&["packages/ui/src/index.ts","packages/utils/src/index.ts","apps/web/src/main.ts"], &[
        ("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - \"apps/*\"\n"),
        ("packages/ui/package.json", r#"{"name":"@acme/ui","exports":{".":"./src/index.ts"}}"#),
        ("packages/utils/package.json", r#"{"name":"@acme/utils","main":"dist/index.js"}"#),
        ("apps/web/package.json", r#"{"name":"web"}"#)]);
    assert_eq!(r.resolve("apps/web/src/main.ts", "@acme/ui"), Resolution::Internal("packages/ui/src/index.ts".into()));
    assert_eq!(r.resolve("apps/web/src/main.ts", "@acme/utils"), Resolution::Internal("packages/utils/src/index.ts".into()));
}
#[test] fn invalid_tsconfig_warns_and_continues() {
    let (r, warnings) = build_with_warnings(&["src/a.ts","src/b.ts"], &[("tsconfig.json", "{ \"compilerOptions\": ")]);
    assert_eq!(warnings, vec!["tsconfig inválido: tsconfig.json"]);
    assert_eq!(r.resolve("src/a.ts", "./b"), Resolution::Internal("src/b.ts".into()));
}
```

Em `workspace.rs`: um teste com `package.json` raiz `{"workspaces":{"packages":["libs/*","!libs/old"]}}` deve retornar só `libs/new`, e um com `package.json` inválido deve gerar o aviso.

- [ ] **Step 2: Rodar e ver falhar.** `cargo test -p archviewer-core resolve workspace`. Esperado: erro de compilação.
- [ ] **Step 3: Implementar** `workspace.rs` e `resolve.rs` seguindo as regras 1 a 4.
- [ ] **Step 4: Rodar e ver passar.** `cargo test -p archviewer-core`. Esperado: todos passando.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): workspace detection and import resolution"`

---

### Task 4: Grafo, hierarquia, ciclos e `Analyzer` (add_files/finish/issues)

**Files:**
- Create: `crates/archviewer-core/src/{cycles.rs,graph.rs,analyzer.rs}`

**Interfaces:**
- Consumes: Tasks 1 a 3.
- Produces:
  - `pub fn strongly_connected(n: usize, adj: &[Vec<usize>]) -> Vec<Vec<usize>>`: Tarjan **iterativo**, com pilha explícita e sem recursão.
  - Interno `pub(crate) struct Graph`, usado pelos Tasks 5 e 6:
    - `nodes: Vec<NodeData>`, indexado por `NodeId`. Ordem: o grupo raiz `0`, depois os grupos, depois os arquivos, depois os externos, cada bloco ordenado por caminho para os ids serem deterministas.
    - `edges: Vec<FileEdge>`, com `out_edges: Vec<Vec<usize>>` e `in_edges: Vec<Vec<usize>>` por nó.
    - `cycles: Vec<Vec<NodeId>>`, os SCCs com mais de um nó ou com auto-import.
    - `cycle_of: HashMap<NodeId, usize>`
    - `unresolved: Vec<UnresolvedImport>`
  - `NodeData { id, kind: NodeKind, group_kind: Option<GroupKind>, path: String, label: String, parent: Option<NodeId>, children: Vec<NodeId>, file: Option<FileData>, in_cycle: bool }`
  - `FileData { language, loc, exports, errors }`
  - `FileEdge { from: NodeId, to: NodeId, kind: ImportKind, specifiers: Vec<String>, in_cycle: bool }`. É única por `(from, to, kind)`; specifiers repetidos são fundidos.
  - `pub struct Analyzer` com:
    - `new(config: AnalyzerConfig) -> Self`
    - `add_files(&mut self, files: Vec<FileInput>) -> Result<AddResult, AnalyzerError>`
    - `finish(&mut self) -> Result<Summary, AnalyzerError>`
    - `issues(&self) -> Issues`
    - `pub(crate) fn graph(&self) -> Option<&Graph>`
  - `pub enum AnalyzerError { AlreadyFinished }`, com `Display` em português: `"análise já finalizada"`.
  - Helpers `#[cfg(test)]` em `analyzer.rs`, para os testes dos Tasks 4 a 6:
    - `pub(crate) fn analyzed(files: &[(&str, &str)]) -> Analyzer`
    - `pub(crate) fn id(a: &Analyzer, path: &str) -> NodeId`
    - `Analyzer::clone_summary(&self) -> Summary`

**Regras:**
- **`add_files`:**
  - Normaliza cada caminho.
  - Não ingestível → `skipped` com `NotIngestible`. Maior que `max_file_bytes` → `TooLarge`.
  - Config → guarda o conteúdo. Código → `parse_source` na hora; o conteúdo é descartado.
  - Caminho repetido substitui o anterior.
  - Depois do `finish`, devolve `Err(AlreadyFinished)`.
- **`finish`:**
  1. Monta as pastas a partir dos caminhos de código.
  2. Roda `detect_workspaces`. A pasta de cada pacote vira grupo `Package`, com `label` = nome do pacote.
  3. As demais pastas viram `Folder`, com label = nome da pasta. A raiz tem `label = project_name` e `path = ""`.
  4. Resolve cada `RawImport`:
     - `Internal` → aresta para o arquivo
     - `External` → nó externo único por nome, mais a aresta
     - `Unresolved` → entra em `unresolved`
  5. Calcula os ciclos com Tarjan sobre as arestas arquivo→arquivo, excluindo `TypeOnly`. Marca `in_cycle` nas arestas não-`TypeOnly` internas a um ciclo e nos arquivos do ciclo. Um grupo tem `in_cycle` se algum arquivo descendente tiver.
  6. Os avisos são os do workspace mais os do resolver, sem duplicatas.
  7. Chamar `finish` de novo devolve o mesmo `Summary`.
- **`Summary`:**
  - `edges` = número de `FileEdge`
  - `cycles` = `cycles.len()`
  - `parse_errors` = arquivos com algum erro
  - `workspace_packages` = número de pacotes

- [ ] **Step 1: Escrever os testes que falham** em `analyzer.rs`:

```rust
#[test] fn sample_like_graph() {
    let a = analyzed(&[("src/a.ts","import {b} from './b'; import 'react';"),("src/b.ts","import {a} from './a';"),
                       ("src/c.ts","import type {A} from './d';"),("src/d.ts","import type {C} from './c';"),("src/e.ts","import s from './s.css';")]);
    let g = a.graph().unwrap(); let s = a.clone_summary();
    assert_eq!((s.files, s.externals, s.cycles, s.unresolved), (5, 1, 1, 1));   // ciclo só de a↔b; c↔d é typeOnly
    let file = |p: &str| g.nodes.iter().find(|n| n.path == p).unwrap();
    assert!(file("src/a.ts").in_cycle && !file("src/c.ts").in_cycle);
    assert!(file("src").in_cycle);
    assert_eq!(a.issues().unresolved[0].reason, UnresolvedReason::Asset);
}
#[test] fn skips_and_errors() {
    let mut a = Analyzer::new(AnalyzerConfig::default());
    let r = a.add_files(vec![FileInput{path:"big.ts".into(), content:"x".repeat(2_097_153)}, FileInput{path:"a.css".into(), content:String::new()}]).unwrap();
    assert_eq!((r.accepted, r.skipped), (0, 2));
    a.finish().unwrap();
    assert!(matches!(a.add_files(vec![]), Err(AnalyzerError::AlreadyFinished)));
    assert_eq!(a.issues().skipped.iter().map(|s| s.reason.clone()).collect::<Vec<_>>(), vec![SkipReason::TooLarge, SkipReason::NotIngestible]);
}
#[test] fn backslash_paths_resolve() {           // Review Focus 1
    let a = analyzed(&[("src\\a.ts","import './b';"),(".\\src\\b.ts","")]);
    assert_eq!(a.clone_summary().edges, 1);
    assert!(a.graph().unwrap().nodes.iter().any(|n| n.path == "src/a.ts"));
}
#[test] fn duplicate_path_last_wins() {         // Review Focus 2
    let mut a = Analyzer::new(AnalyzerConfig::default());
    a.add_files(vec![FileInput{path:"a.ts".into(), content:"import 'x';".into()}]).unwrap();
    a.add_files(vec![FileInput{path:"a.ts".into(), content:"import 'y';".into()}]).unwrap();
    let s = a.finish().unwrap();
    assert_eq!((s.files, s.externals), (1, 1));
}
#[test] fn deep_chain_no_stack_overflow() {     // Review Focus 3
    let files: Vec<(String,String)> = (0..50_000).map(|i| (format!("f{i}.ts"), format!("import './f{}';", i + 1))).collect();
    let refs: Vec<(&str,&str)> = files.iter().map(|(p,c)| (p.as_str(), c.as_str())).collect();
    assert_eq!(analyzed(&refs).clone_summary().cycles, 0);
}
#[test] fn self_import_is_cycle() { assert_eq!(analyzed(&[("a.ts","import './a';")]).clone_summary().cycles, 1); }
```

Em `cycles.rs`, testar que `strongly_connected` sobre `0→1→2→0, 3→3, 4` devolve exatamente os componentes `{0,1,2}`, `{3}` e `{4}`.

- [ ] **Step 2: Rodar e ver falhar.** `cargo test -p archviewer-core`. Esperado: erro de compilação.
- [ ] **Step 3: Implementar** `cycles.rs`, `graph.rs` e `analyzer.rs`.
- [ ] **Step 4: Rodar e ver passar.** `cargo test -p archviewer-core`. Esperado: todos passando. O `deep_chain` deve levar menos de 10 s em debug.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): graph build, hierarchy, Tarjan cycles and Analyzer"`

---

### Task 5: Expansão padrão e visão agregada (`view.rs`)

**Files:**
- Create: `crates/archviewer-core/src/view.rs`
- Modify: `analyzer.rs`

**Interfaces:**
- Consumes: `Graph` e `Analyzer::graph()` (Task 4).
- Produces:
  - `Analyzer::default_expansion(&self) -> Vec<NodeId>`
  - `Analyzer::view(&self, expanded: &[NodeId]) -> VisibleGraph`

**Regras:**
- **`default_expansion`:**
  1. Começa com `{0}`.
  2. Se houver pacotes, adiciona todo grupo `Folder` que seja ancestral estrito de um grupo `Package`.
  3. Repete enquanto os nós visíveis com `expanded: false` (sem contar externos) forem exatamente um grupo e nenhum arquivo: expande esse grupo.
  4. Devolve a lista em ordem crescente.
  5. Antes do `finish`, devolve `[0]`.
- **`view`:**
  - **Visibilidade:** a raiz é sempre considerada expandida. Ids inválidos ou que não são grupos são ignorados. Um nó entra em `nodes` quando não é a raiz e todos os seus ancestrais estão expandidos.
    - Grupos expandidos entram com `expanded: true`. Eles servem ao explorador de arquivos; o renderer não os desenha, e nenhuma aresta aponta para eles.
    - Externos sempre entram.
  - **Representante:** para cada arquivo, é o ancestral de mais alto nível (sem contar a raiz) que não está expandido. Se não houver, é o próprio arquivo.
  - **Arestas:** cada `FileEdge` vira `(rep(from), rep(to))`. Pares com os dois lados iguais são descartados. As restantes são agrupadas por par:
    - `weight` = quantidade de arestas no par
    - `in_cycle` = alguma tem `in_cycle`
    - `type_only` = todas são `TypeOnly`
  - **Tamanho (`size`):**
    - grupo = número de arquivos descendentes
    - arquivo = `loc`
    - externo = número de arquivos distintos que o importam
  - `expandable` = é um grupo com filhos.
  - **Ordenação:** nós por id, arestas por `(from, to)`.
  - Antes do `finish`, devolve um grafo vazio.

- [ ] **Step 1: Escrever os testes que falham** em `view.rs`:

```rust
#[test] fn collapses_single_child_chain() {
    let a = analyzed(&[("src/app/a.ts","import '../lib/b';"),("src/lib/b.ts","import 'react';")]);
    assert_eq!(a.default_expansion(), vec![0, id(&a, "src")]);
}
#[test] fn aggregates_between_groups() {
    let a = analyzed(&[("src/app/a.ts","import '../lib/b'; import '../lib/c';"),("src/app/d.ts","import '../lib/b';"),
                       ("src/lib/b.ts",""),("src/lib/c.ts","import type {X} from '../app/a';")]);
    let v = a.view(&a.default_expansion());
    let (app, lib) = (id(&a,"src/app"), id(&a,"src/lib"));
    let e = |f, t| v.edges.iter().find(|e| e.from == f && e.to == t).cloned().unwrap();
    assert_eq!(e(app, lib).weight, 3); assert!(!e(app, lib).type_only);
    assert!(e(lib, app).type_only);
    assert_eq!(v.nodes.iter().find(|n| n.id == app).unwrap().size, 2);
}
#[test] fn expanding_reveals_files() {
    let a = analyzed(&[("src/app/a.ts","import '../lib/b';"),("src/lib/b.ts","")]);
    let mut exp = a.default_expansion(); exp.push(id(&a, "src/lib"));
    let v = a.view(&exp);
    assert!(v.edges.iter().any(|e| e.from == id(&a,"src/app") && e.to == id(&a,"src/lib/b.ts")));
}
#[test] fn workspace_packages_on_top() {
    let a = analyzed(&[("pnpm-workspace.yaml","packages:\n  - 'packages/*'\n"),("packages/ui/package.json",r#"{"name":"@acme/ui"}"#),
                       ("packages/ui/src/i.ts",""),("scripts/build.mjs","")]);
    let labels: Vec<String> = a.view(&a.default_expansion()).nodes.into_iter().filter(|n| !n.expanded).map(|n| n.label).collect();
    assert_eq!(labels, vec!["@acme/ui", "scripts"]);
}
#[test] fn invalid_ids_and_before_finish() {        // Review Focus 4
    let a = analyzed(&[("src/a.ts","")]);
    assert_eq!(a.view(&[999_999, id(&a,"src/a.ts")]), a.view(&[]));
    let b = Analyzer::new(AnalyzerConfig::default());
    assert!(b.view(&[0]).nodes.is_empty()); assert_eq!(b.default_expansion(), vec![0]);
}
#[test] fn empty_project() {                        // Review Focus 5
    let a = analyzed(&[("README.md","")]);
    assert_eq!(a.clone_summary().files, 0); assert_eq!(a.default_expansion(), vec![0]);
    assert!(a.view(&[0]).nodes.is_empty());
}
```

- [ ] **Step 2: Rodar e ver falhar.** `cargo test -p archviewer-core view`. Esperado: erro de compilação.
- [ ] **Step 3: Implementar** `view.rs` e expor os dois métodos no `Analyzer`.
- [ ] **Step 4: Rodar e ver passar.** `cargo test -p archviewer-core`. Esperado: todos passando.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): default expansion and aggregated views"`

---

### Task 6: Detalhes e busca (`detail.rs`)

**Files:**
- Create: `crates/archviewer-core/src/detail.rs`
- Modify: `analyzer.rs`

**Interfaces:**
- Consumes: `Graph` (Task 4).
- Produces:
  - `Analyzer::detail(&self, id: NodeId) -> Option<Detail>`
  - `Analyzer::find(&self, query: &str, limit: usize) -> Vec<SearchHit>`

**Regras:**
- **`FileDetail`:**
  - `imports` e `imported_by` vêm das `FileEdge`, ordenadas por caminho.
  - `unresolved` = os itens com `from` igual a este arquivo.
  - `cycle` = caminhos ordenados do SCC do arquivo, ou vazio.
  - `fan_in` = número de arquivos distintos que o importam.
  - `fan_out` = número de alvos distintos (arquivos e externos).
- **`GroupDetail`:**
  - `file_count` e `loc` somam os descendentes.
  - `top_outgoing`/`top_incoming`: arestas que cruzam a fronteira do grupo, agregadas pela **pasta-mãe do arquivo do outro lado**. Externos são agregados pelo próprio nó externo. São ordenadas por `weight` decrescente e depois por caminho, e limitadas a 10.
- **`ExternalDetail`:** `imported_by` ordenado por caminho.
- **`find`:**
  - Considera arquivos e grupos, exceto a raiz.
  - Comparação sem diferenciar maiúsculas de minúsculas, por substring no `path`.
  - **Ordem:** primeiro rótulos que começam com a busca, depois rótulos que contêm a busca, depois o resto. Dentro de cada faixa, caminho mais curto primeiro, e em seguida ordem alfabética.
  - `ancestors` = ids da raiz até o pai, de cima para baixo, **incluindo** o `0`.
  - Busca vazia devolve `[]`.

- [ ] **Step 1: Escrever os testes que falham** em `detail.rs`:

```rust
#[test] fn file_detail() {
    let a = analyzed(&[("src/a.ts","import {x} from './b'; import 'react'; import './gone';"),("src/b.ts","import './a'; export const x = 1;")]);
    let Some(Detail::File(d)) = a.detail(id(&a, "src/b.ts")) else { panic!() };
    assert_eq!((d.fan_in, d.fan_out), (1, 1));
    assert_eq!(d.exports, vec!["x"]); assert_eq!(d.cycle, vec!["src/a.ts", "src/b.ts"]);
    assert_eq!(d.imported_by[0].specifiers, vec!["x"]);
    let Some(Detail::File(da)) = a.detail(id(&a, "src/a.ts")) else { panic!() };
    assert_eq!(da.fan_out, 2); assert_eq!(da.unresolved[0].specifier, "./gone");
}
#[test] fn group_detail_top_deps() {
    let a = analyzed(&[("src/app/a.ts","import '../lib/b'; import '../lib/c'; import 'react';"),("src/lib/b.ts",""),("src/lib/c.ts","")]);
    let Some(Detail::Group(g)) = a.detail(id(&a, "src/app")) else { panic!() };
    assert_eq!(g.top_outgoing.iter().map(|w| (w.path.as_str(), w.weight)).collect::<Vec<_>>(), vec![("src/lib", 2), ("react", 1)]);
}
#[test] fn find_ranks_and_ancestors() {
    let a = analyzed(&[("src/components/Button.tsx",""),("src/ui/IconButton.tsx",""),("src/button-utils/x.ts","")]);
    let hits = a.find("button", 10);
    assert_eq!(hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), vec!["src/button-utils", "src/components/Button.tsx", "src/ui/IconButton.tsx", "src/button-utils/x.ts"]);
    assert_eq!(hits[1].ancestors, vec![0, id(&a,"src"), id(&a,"src/components")]);
    assert!(a.find("", 10).is_empty());
}
#[test] fn invalid_id() { assert!(analyzed(&[("a.ts","")]).detail(424_242).is_none()); }   // Review Focus 4
```

- [ ] **Step 2: Rodar e ver falhar.** `cargo test -p archviewer-core detail`. Esperado: erro de compilação.
- [ ] **Step 3: Implementar** `detail.rs` e expor `detail` e `find` no `Analyzer`.
- [ ] **Step 4: Rodar e ver passar.** `cargo test -p archviewer-core`. Esperado: todos passando.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): file/group/external detail and search"`

---

### Task 7: Fixtures, snapshots e teste de desempenho

**Files:**
- Create: `fixtures/tsconfig-paths/`, `fixtures/monorepo-pnpm/`, `fixtures/commonjs/`, `fixtures/broken/` (conteúdo abaixo)
- Create: `crates/archviewer-core/tests/{common/mod.rs,fixtures.rs,perf.rs}`

**Interfaces:**
- Consumes: a API pública do `Analyzer` (Tasks 4 a 6) e `is_ingestible`.
- Produces: `tests/common/mod.rs::load_fixture(name: &str) -> Vec<FileInput>`. Percorre `fixtures/<name>`, mantém os caminhos que passam em `is_ingestible` (relativos à pasta do fixture) e os devolve ordenados.

**Conteúdo das fixtures** (mínimo; o conteúdo exato fica a critério de quem implementa, desde que satisfaça as asserções):

| Fixture | Arquivos | O que exercita |
|---|---|---|
| `tsconfig-paths` | `tsconfig.base.json` (`paths: {"@lib/*": ["src/lib/*"]}`), `tsconfig.json` (com comentário, vírgula sobrando e `extends: "./tsconfig.base.json"`), `src/main.ts` (importa `@lib/math`, `./util.js`, `@lib/nope`, `~/missing`), `src/lib/math.ts`, `src/util.ts` | `extends`, JSONC, `extensionAlias`, `UnknownAlias` |
| `monorepo-pnpm` | `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `packages/ui` (`@acme/ui`, `exports` com `.` e `./button`), `packages/utils` (`@acme/utils`, `main: dist/index.js`, mais `src/index.ts`), `apps/web` (`web`, `src/main.tsx` importa `@acme/ui`, `@acme/ui/button`, `@acme/utils`, `react`), `scripts/build.mjs` | pacotes, `exports`, fallback de fonte |
| `commonjs` | `index.js` (`require('./a')` no topo, `require('./lib/b')` dentro de função, `module.exports = {}`), `a.js` (`exports.x`, `module.exports.y`), `lib/b.js` (`import('../a.js')`), `lib/c.ts` (`import a = require('../a')`) | require aninhado, dinâmico, CJS exports |
| `broken` | `tsconfig.json` inválido, `src/ok.ts` (importa `./bad`, `./missing`, `./styles.css?inline`), `src/bad.ts` com erro de sintaxe na linha 2 | erros, avisos, assets |

- [ ] **Step 1: Escrever os testes que falham** em `tests/fixtures.rs`. Uma função por fixture, que roda `load_fixture`, `add_files`, `finish` e serializa um snapshot:

```rust
fn snapshot(name: &str) -> serde_json::Value {
    let mut a = Analyzer::new(AnalyzerConfig { project_name: name.into(), ..Default::default() });
    a.add_files(common::load_fixture(name)).unwrap();
    let summary = a.finish().unwrap();
    let all_groups = expand_all(&a); // default_expansion + ids `expandable` da view atual, em loop até estabilizar
    serde_json::json!({ "summary": summary, "default": paths(&a, &a.view(&a.default_expansion())),
                        "full": paths(&a, &a.view(&all_groups)), "issues": a.issues() })
}
```

O `paths()` troca ids por caminhos em nós e arestas, para o snapshot ser estável e legível.

Asserções explícitas, além do `insta::assert_json_snapshot!`:
- `sample-project`:
  - `summary.cycles == 1`
  - `issues.unresolved` contém `./Button.module.css` com `asset`
  - no `full`, existe aresta `src/dynamic/lazy.ts → src/utils/helpers.ts`
  - `App.tsx` resolve `@/utils/helpers` para `src/utils/helpers.ts`
- `tsconfig-paths`: `edges` contém `src/main.ts → src/lib/math.ts` e `→ src/util.ts`; os não resolvidos são exatamente `@lib/nope` e `~/missing`, ambos `unknownAlias`.
- `monorepo-pnpm`:
  - `summary.workspacePackages == 3`
  - o conjunto de rótulos dos nós não expandidos da `default` é `{web, @acme/ui, @acme/utils, scripts, react}`
  - `@acme/ui/button` resolve para `packages/ui/src/button.tsx`
- `commonjs`: as arestas de `index.js` são do tipo `require` para `a.js` e `lib/b.js`; `lib/b.js → a.js` é `dynamic`; os exports de `a.js` são `["x","y"]`.
- `broken`:
  - `warnings == ["tsconfig inválido: tsconfig.json"]`
  - `parseErrors[0].path == "src/bad.ts"` com `line == 2`
  - os não resolvidos são `./missing` (`notFound`) e `./styles.css?inline` (`asset`)

`tests/perf.rs` (com `#[ignore]`):
- **Projeto gerado:** 200 pastas `mN/` com 100 arquivos cada (20.000 no total). Cada arquivo importa 3 arquivos de outras pastas por caminho relativo e `react`.
- **Medição:** `finish()`, mais `view(default_expansion())`, mais `view(todos os grupos)`.
- **Asserção:** o total deve ser menor que 5 s em release.

- [ ] **Step 2: Rodar e ver falhar.** `cargo add --dev insta --features json` e criar as fixtures. Depois `cargo test -p archviewer-core --test fixtures`. Esperado: as asserções passam e o `insta` reporta snapshots novos pendentes.
- [ ] **Step 3: Revisar e aceitar os snapshots.** `cargo insta review` (ou `INSTA_UPDATE=always`). Ler cada `.snap` e confirmar que bate com as asserções acima antes de aceitar.
- [ ] **Step 4: Rodar tudo.** `cargo test -p archviewer-core && cargo test -p archviewer-core --release --test perf -- --ignored`. Esperado: tudo passando e o perf abaixo de 5 s.
- [ ] **Step 5: Commit.** `git add fixtures crates && git commit -m "test(core): fixture snapshots and 20k-file perf check"`

---

### Task 8: `core-wasm`, build, teste de fronteira e CI

**Files:**
- Create: `packages/core-wasm/{Cargo.toml,src/lib.rs,package.json,scripts/build.mjs,test/analyzer.test.ts,tsconfig.json,vitest.config.ts}`, `.github/workflows/core.yml`
- Modify:
  - `Cargo.toml` raiz (adicionar o membro)
  - `crates/archviewer-core/Cargo.toml` (feature `wasm`)
  - `package.json` raiz (`build:wasm` → `pnpm --filter @archviewer/core-wasm build`)
  - `turbo.json` (o `test` do core-wasm depende do `build`)
  - `README.md` (pré-requisitos: trocar `wasm-pack` por `wasm32-unknown-unknown` + `wasm-bindgen-cli`)

**Interfaces:**
- Consumes: a API pública do `Analyzer` (Tasks 4 a 6).
- Produces, para o Plano 2, a API JS de `@archviewer/core-wasm` (`pkg/core_wasm.js` + `.d.ts`):

```ts
export default function init(input?: { module_or_path: BufferSource | URL | string }): Promise<unknown>;
export function isIngestible(path: string): boolean;
export function ignoredDirs(): string[];
export class Analyzer {
  constructor(config: AnalyzerConfig);
  addFiles(files: FileInput[]): AddResult;        // lança Error("análise já finalizada")
  finish(): Summary;
  defaultExpansion(): number[];
  view(expanded: number[]): VisibleGraph;
  detail(id: number): Detail | undefined;
  issues(): Issues;
  find(query: string, limit: number): SearchHit[];
  free(): void;
}
// + todos os tipos de model.rs, gerados pelo tsify-next, com campos em camelCase
```

**Decisões:**
- **Wrapper:** um `#[wasm_bindgen] struct Analyzer(archviewer_core::Analyzer)`, com `#[wasm_bindgen(js_name = ...)]` para nomes camelCase. Erros viram `JsError`. Um `#[wasm_bindgen(start)]` instala o `console_error_panic_hook`.
- **Build** (`scripts/build.mjs`):
  1. `cargo build -p archviewer-core-wasm --release --target wasm32-unknown-unknown`
  2. `wasm-bindgen --target web --out-dir pkg target/wasm32-unknown-unknown/release/archviewer_core_wasm.wasm`
  3. Antes, conferir se `wasm-bindgen --version` bate com a versão fixada no `Cargo.lock`. Se não bater, encerrar com a mensagem de instalação: `cargo install wasm-bindgen-cli --version <v>`.
- **`package.json`:** `"name": "@archviewer/core-wasm"`, `"main": "pkg/core_wasm.js"`, `"types": "pkg/core_wasm.d.ts"`, scripts `build`, `test` (`vitest run`) e `clean`.

- [ ] **Step 1: Escrever o teste que falha** em `test/analyzer.test.ts`. Ele carrega o `.wasm` com `readFileSync` e chama `init({ module_or_path: bytes })`. As fixtures são lidas com o mesmo filtro, via `isIngestible`:

```ts
it('analisa o sample-project com campos camelCase', () => {
  const a = new Analyzer({ projectName: 'sample', maxFileBytes: 2_097_152 });
  a.addFiles(loadFixture('sample-project'));
  const s = a.finish();
  expect(s).toMatchObject({ files: 8, cycles: 1, externals: 2 }); // externos: react, date-fns
  expect(Object.keys(s)).toContain('parseErrors');
  const v = a.view(a.defaultExpansion());
  expect(v.nodes.filter(n => n.kind !== 'external').every(n => typeof n.parentId === 'number')).toBe(true);
  expect(a.issues().unresolved.map(u => u.reason)).toEqual(['asset']);
  const lazy = a.find('lazy.ts', 1)[0];
  const d = a.detail(lazy.id)!;
  expect(d.kind).toBe('file');
  if (d.kind === 'file') expect(d.imports.map(i => i.kind)).toEqual(['dynamic', 'dynamic']);
  expect(() => a.addFiles([])).toThrow('análise já finalizada');
  expect(a.detail(999_999)).toBeUndefined();
  a.free();
});
it('isIngestible segue as regras do core', () => {
  expect(isIngestible('src/a.ts')).toBe(true);
  expect(isIngestible('node_modules/x.js')).toBe(false);
  expect(ignoredDirs()).toContain('node_modules');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cargo add -p archviewer-core-wasm wasm-bindgen@=<versão> serde-wasm-bindgen console_error_panic_hook tsify-next --features tsify-next/js`, depois `cargo install wasm-bindgen-cli --version <mesma>`, depois `pnpm install && pnpm --filter @archviewer/core-wasm test`. Esperado: falha, porque o `pkg/` ainda não existe e o wrapper não foi implementado.
- [ ] **Step 3: Implementar** o wrapper, a feature `wasm` do core e o `build.mjs`.
- [ ] **Step 4: Rodar e ver passar.** `pnpm --filter @archviewer/core-wasm build && pnpm --filter @archviewer/core-wasm test`. Esperado: 2 testes passando. Conferir também que `pkg/core_wasm.d.ts` declara `interface Summary` com `parseErrors: number`.
- [ ] **Step 5: CI.** Criar `.github/workflows/core.yml` (em push e PR):
  1. checkout
  2. `dtolnay/rust-toolchain@stable` com o target `wasm32-unknown-unknown`
  3. `Swatinem/rust-cache`
  4. `cargo test --workspace`
  5. `cargo test -p archviewer-core --release --test perf -- --ignored`
  6. instalar o `wasm-bindgen-cli` na versão do `Cargo.lock` (`taiki-e/install-action` com `wasm-bindgen-cli@<v>`)
  7. `pnpm/action-setup` (9.15) + Node 22
  8. `pnpm install --frozen-lockfile`
  9. `pnpm --filter @archviewer/core-wasm build && pnpm --filter @archviewer/core-wasm test`
- [ ] **Step 6: Commit.** `git add -A packages/core-wasm .github Cargo.toml Cargo.lock crates package.json turbo.json README.md pnpm-lock.yaml && git commit -m "feat(core-wasm): wasm-bindgen wrapper, typed JS API, boundary tests and CI"`

---

## Próximo plano

O **Plano 2 (app web)** usa a API JS do Task 8. Ele cobre:
- `ingest/` dentro do worker, usando `isIngestible`/`ignoredDirs`
- `analysis.worker`
- `graph-store` (Zustand)
- `renderer/` (Sigma.js + ForceAtlas2 em worker, tokens via `getComputedStyle`)
- os componentes no tema Hallmark Cobalt (modo App screens, `sloplint --scope app`)
- a tela de leitura com o campo ASCII
- o Playwright e o CI do app

Ele é escrito depois que este plano for executado, para partir dos tipos reais gerados.
