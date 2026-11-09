# ArchViewer

> See the architecture of any JavaScript/TypeScript project as an interactive graph, right in your browser. Your code never leaves your machine.

[![CI](https://github.com/engviniciusbs/archviewer/actions/workflows/core.yml/badge.svg)](https://github.com/engviniciusbs/archviewer/actions/workflows/core.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[Try it → archviewer.viniciusbsarmento.com](https://archviewer.viniciusbsarmento.com)** · [Leia em português](README.pt-BR.md)

![ArchViewer showing the dependencies of a file in its own web app](docs/assets/screenshot.png)

Open a project folder and ArchViewer draws its folders, files and imports as a graph you can expand, collapse and search. Nothing to install, no account, no upload.

> **Note:** the interface is currently in Portuguese. An English UI is on the [roadmap](#roadmap).

## Features

- **Interactive graph**: WebGL rendering with Sigma.js and graphology. Folders start collapsed and expand on demand, so large projects stay readable.
- **Precise analysis in WebAssembly**: a Rust core built on [OXC](https://oxc.rs) parses every file's AST and resolves imports the way your toolchain does (`tsconfig` paths and references, `package.json` exports, workspaces). It runs in a Web Worker.
- **Cycles and loose ends**: circular dependencies are highlighted, and unresolved imports are listed with the reason.
- **Explorer, search and details**: a file tree, search by name or path, and a detail panel with fan-in, fan-out, imports, dependents and a code snippet.
- **Monorepo aware**: pnpm and npm/yarn workspaces are detected and shown as packages.
- **Private by design**: files are read locally and analyzed on your machine. No file, path or metric is sent anywhere.

## How it works

```
your folder ──► ingest (browser) ──► Web Worker ──► archviewer-core (Rust → WASM)
                 .gitignore,                         parse (OXC), resolve imports,
                 ignored dirs,                       build graph, find cycles
                 batched reads                                │
                                                              ▼
                              React UI ◄── visible graph, details, search
                              (Sigma.js / WebGL)
```

- Code files: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`.
- Skipped: `node_modules`, `dist`, `build`, hidden folders, anything in `.gitignore`, and files over 2 MB.
- Analysis of a 20,000-file synthetic project is checked in CI.

## Browser support

| Browser | Folder access | Status |
|---------|---------------|--------|
| Chrome / Edge | File System Access API | Full support |
| Firefox | File picker (`webkitdirectory`) | Works, without direct folder access |
| Safari | File picker (`webkitdirectory`) | Works, without direct folder access |

## Development

You need Node.js ≥ 20, pnpm ≥ 9 and Rust with the wasm target:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130   # must match Cargo.lock

git clone https://github.com/engviniciusbs/archviewer.git
cd archviewer
pnpm install
pnpm build:wasm
pnpm --filter @archviewer/web dev
```

Tests, project layout and Windows notes are in [CONTRIBUTING.md](CONTRIBUTING.md). Production deployment is described in [docs/deploy.md](docs/deploy.md) (in Portuguese).

```
archviewer/
├── crates/archviewer-core/   # Rust core: parsing, resolution, graph, cycles
├── packages/core-wasm/       # wasm-bindgen wrapper with a typed JS API
├── apps/web/                 # React + Vite + Sigma app
└── fixtures/sample-project/  # sample project used by the tests
```

## Roadmap

Planned next, roughly in this order:

- **English interface** (i18n EN/PT, following the browser language)
- **Export and share**: PNG/SVG, JSON, Mermaid and a README badge
- **Metrics and heatmap**: color nodes by fan-in, fan-out and size to find hotspots
- **Dead code**: files nobody imports and unused exports
- **Compare versions**: what changed in the architecture between two branches

Follow progress in the [roadmap issue](https://github.com/engviniciusbs/archviewer/issues/8). Ideas are welcome.

## Contributing

Issues and pull requests are welcome. Look for [`good first issue`](https://github.com/engviniciusbs/archviewer/labels/good%20first%20issue) to get started, and read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
