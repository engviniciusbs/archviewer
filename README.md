# ArchViewer

> Visualizador de arquitetura de software, 100% no navegador

O ArchViewer abre a pasta de um projeto JavaScript/TypeScript e mostra a arquitetura dele como um grafo interativo: pastas, arquivos, dependências e imports.

## Recursos

- **Grafo interativo**: renderizado em WebGL com Sigma e graphology, com grupos que se expandem e se recolhem.
- **Analisador em WebAssembly**: parsing de AST em Rust (OXC) para extrair imports e exports com precisão, rodando num worker.
- **Ciclos e pendências**: destaca dependências circulares e lista os imports que não foram resolvidos.
- **Explorador, busca e detalhes**: árvore de arquivos, busca por nome e caminho, e um painel com fan-in, fan-out, imports e trecho do código.
- **Privacidade**: o código nunca sai do navegador.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19 + Vite + Sigma (WebGL) |
| Analisador | Rust + OXC → WebAssembly, em um Web Worker |
| Testes | Vitest, Playwright e `cargo test` |
| Monorepo | pnpm workspaces |

## Primeiros passos

### Pré-requisitos

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://rustup.rs/) (para compilar o core em Wasm), com o target wasm e a CLI do bindgen:

  ```bash
  rustup target add wasm32-unknown-unknown
  cargo install wasm-bindgen-cli --version 0.2.130
  ```

  A versão da CLI precisa ser a mesma do `wasm-bindgen` fixado no `Cargo.lock`; o `pnpm build:wasm` confere isso e mostra o comando de instalação se houver diferença.

**Nota para Windows:** compilar Rust exige um linker. Instale as MSVC Build Tools ou use a toolchain GNU (`rustup override set stable-x86_64-pc-windows-gnu`) com o MinGW-w64 no `PATH`.

### Rodar o app

```bash
# Clonar
git clone https://github.com/engviniciusbs/archviewer.git
cd archviewer

# Instalar dependências
pnpm install

# Compilar o analisador Wasm
pnpm build:wasm

# Subir o servidor de desenvolvimento
pnpm --filter @archviewer/web dev
```

### Uso

1. Abra o app no Chrome ou no Edge (no Firefox e no Safari, a pasta é escolhida pelo seletor de arquivos).
2. Clique em "Abrir projeto" e escolha a pasta do seu projeto JS/TS.
3. Explore o grafo de dependências.
4. Selecione um nó, no grafo ou no explorador, para ver imports, dependentes e ciclos.

### Testes

```bash
pnpm --filter @archviewer/web typecheck
pnpm --filter @archviewer/web lint
pnpm --filter @archviewer/web test

# Ponta a ponta (compila o app e abre o fixtures/sample-project num navegador real)
pnpm --filter @archviewer/web exec playwright install chromium
pnpm --filter @archviewer/web e2e
```

Sem o Chromium do Playwright, use um navegador instalado: `PW_CHANNEL=msedge pnpm --filter @archviewer/web e2e`.

## Arquitetura

```
archviewer/
├── crates/
│   └── archviewer-core/ # núcleo em Rust: parsing, resolução e grafo
├── packages/
│   └── core-wasm/       # wrapper wasm-bindgen em volta do archviewer-core
├── apps/
│   └── web/             # aplicação React + Sigma
└── fixtures/
    └── sample-project/  # projeto de exemplo para testes
```

## Suporte de navegadores

| Navegador | Acesso a arquivos | Status |
|-----------|-------------------|--------|
| Chrome / Edge | File System Access API | Suporte completo |
| Firefox | Seletor de arquivos (`webkitdirectory`) | Funciona, com o aviso de que não há acesso direto à pasta |
| Safari | Seletor de arquivos (`webkitdirectory`) | Funciona, com o aviso de que não há acesso direto à pasta |

## Privacidade

Nada sai do navegador. A pasta é lida localmente, analisada por um worker em WebAssembly na sua máquina, e nenhum arquivo, caminho ou métrica é enviado a servidor algum.

## Produção

O app roda em **https://archviewer.viniciusbsarmento.com**.

- Todo push na `main` dispara o workflow `ci`. Se o job `core` passar (Rust, WASM, testes, typecheck, lint e e2e), o job `deploy` publica o `apps/web/dist` no environment `production`.
- O app é estático. Na VPS, o nginx serve `/var/www/archviewer/current`, e só o Cloudflare (proxy, SSL strict) chega à origem.
- O deploy entra como o usuário `archviewer`. A chave dele é restrita, no servidor, ao script [`deploy/archviewer-receive.sh`](deploy/archviewer-receive.sh), instalado em `/usr/local/bin/archviewer-receive`. O script cria uma release nova, troca o link `current` e mantém as 5 últimas.
- **Rollback:** na VPS, aponte `current` para uma release anterior, por exemplo `ln -sfn /var/www/archviewer/releases/<release> /var/www/archviewer/current`.
- **Secrets** (environment `production`, liberado só para a `main`): `ARCHVIEWER_DEPLOY_KEY`, `ARCHVIEWER_KNOWN_HOSTS` e a variável `DEPLOY_HOST`.

## Licença

MIT
