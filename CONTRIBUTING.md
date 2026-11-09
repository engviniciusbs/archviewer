# Contributing to ArchViewer

Thanks for helping out! Issues and pull requests can be written in English or Portuguese.

## Before you start

- For a bug, open an issue with steps to reproduce. A small sample project (or the shape of the imports involved) helps a lot.
- For a feature, open an issue first so we can agree on the approach before you write code.
- Issues labeled [`good first issue`](https://github.com/engviniciusbs/archviewer/labels/good%20first%20issue) are small and self-contained. Comment on one to claim it.

## Setup

Requirements:

- [Node.js](https://nodejs.org/) ≥ 20 and [pnpm](https://pnpm.io/) ≥ 9
- [Rust](https://rustup.rs/) (stable) with the wasm target and the wasm-bindgen CLI:

  ```bash
  rustup target add wasm32-unknown-unknown
  cargo install wasm-bindgen-cli --version 0.2.130
  ```

  The CLI version must match the `wasm-bindgen` crate pinned in `Cargo.lock`. `pnpm build:wasm` checks this and prints the install command if they differ.

**Windows:** Rust needs a linker. Install the MSVC Build Tools, or use the GNU toolchain (`rustup override set stable-x86_64-pc-windows-gnu`) with MinGW-w64 on your `PATH`.

Then:

```bash
pnpm install
pnpm build:wasm                    # compiles the Rust core to WebAssembly
pnpm --filter @archviewer/web dev  # starts the app on http://localhost:5173
```

Rebuild the WASM (`pnpm build:wasm`) whenever you change Rust code.

## Project layout

| Path | What lives there |
|------|------------------|
| `crates/archviewer-core` | Pure Rust core, no WASM dependency. Parsing with OXC (`parse.rs`), import resolution (`resolve.rs`), the graph (`graph.rs`), cycles (`cycles.rs`), aggregated views (`view.rs`), node details (`detail.rs`) and workspace detection (`workspace.rs`). |
| `packages/core-wasm` | `wasm-bindgen` wrapper exposing the core to JS with generated TypeScript types. |
| `apps/web/src/ingest` | Reading the folder in the browser: ignored dirs, `.gitignore`, batching. |
| `apps/web/src/analysis` | Web Worker hosting the WASM analyzer and its typed client. |
| `apps/web/src/store` | Zustand store: expansion, selection, filters, search. |
| `apps/web/src/renderer` | Sigma.js canvas, layout and graph sync. |
| `apps/web/src/components` | UI components. |
| `fixtures/sample-project` | Small project used by Rust snapshot tests and the e2e test. |

## Checks

Run what applies to your change before opening a PR. CI runs all of them.

```bash
# Rust
cargo fmt --all -- --check
cargo test --workspace

# WASM wrapper
pnpm --filter @archviewer/core-wasm build
pnpm --filter @archviewer/core-wasm test

# Web
pnpm --filter @archviewer/web typecheck
pnpm --filter @archviewer/web lint
pnpm --filter @archviewer/web test

# End to end (builds the app and opens fixtures/sample-project in a real browser)
pnpm --filter @archviewer/web exec playwright install chromium
pnpm --filter @archviewer/web e2e
```

Without Playwright's Chromium you can use an installed browser: `PW_CHANNEL=msedge pnpm --filter @archviewer/web e2e`.

## Guidelines

- **Add tests with your change.** Resolver and graph behavior is covered by Rust tests and fixture snapshots in `crates/archviewer-core/tests`. UI behavior is covered by Vitest and Testing Library in `apps/web/test`.
- **Keep the core pure.** `archviewer-core` must not depend on WASM or browser APIs, so it can also power a native CLI later.
- **Privacy is a feature.** The app must never send code, paths or metrics over the network.
- **Accessibility matters.** Keep keyboard navigation and ARIA roles working; the e2e test relies on them.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a scope:

```
feat(core): detect unused exports
fix(web): keep the selection when a group collapses
docs: explain the resolver fallbacks
```

Common scopes: `core`, `core-wasm`, `web`, `ci`. Keep each PR focused on one change and describe how you tested it.

## Code of Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
