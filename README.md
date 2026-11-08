# ArchViewer

> Software Architecture Visualizer — 100% browser-based

ArchViewer lets you select a local JavaScript/TypeScript project folder and instantly generates an interactive architecture map showing files, folders, dependencies, and imports.

## Features

- **🕸️ Interactive Graph** — Force-directed visualization of your project's dependency tree with D3.js
- **⚡ WebAssembly Parser** — Rust-powered AST parsing via OXC for accurate import/export extraction
- **🤖 AI Insights** — Ask AI to explain files, suggest refactors, or find architectural issues
- **🔒 Privacy-First** — All code stays in your browser. Nothing leaves unless you explicitly ask AI.
- **🎨 Terminal Theme** — Phosphor-green-on-black aesthetic built for developers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + D3.js + Vite |
| Parser | Rust + OXC → WebAssembly |
| AI | OpenAI / Anthropic (bring your own key) |
| Styling | Hallmark Terminal theme (Martian Mono) |
| Monorepo | pnpm workspaces + Turborepo |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://rustup.rs/) (for building the Wasm parser)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

### Install & Run

```bash
# Clone
git clone https://github.com/engviniciusbs/archviewer.git
cd archviewer

# Install dependencies
pnpm install

# Build Wasm parser
pnpm build:wasm

# Start dev server
pnpm dev
```

### Usage

1. Open the app in Chrome/Edge (or Firefox/Safari with limited features)
2. Click "Open Project" and select your JS/TS project folder
3. Explore the interactive dependency graph
4. Click any node to see details and ask AI for insights

## Architecture

```
archviewer/
├── packages/
│   ├── wasm-parser/     # Rust → WebAssembly (OXC AST parser)
│   └── ai-bridge/       # LLM abstraction layer (TypeScript)
├── apps/
│   └── web/             # React + D3.js application
└── fixtures/
    └── sample-project/  # Test fixtures
```

## Browser Support

| Browser | File Access | Status |
|---------|------------|--------|
| Chrome / Edge | File System Access API | ✅ Full support |
| Firefox | webkitdirectory fallback | ⚠️ Limited |
| Safari | webkitdirectory fallback | ⚠️ Limited |

## License

MIT
