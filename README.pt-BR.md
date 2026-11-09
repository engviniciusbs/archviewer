# ArchViewer

> Veja a arquitetura de qualquer projeto JavaScript/TypeScript como um grafo interativo, direto no navegador. Encontre pontos críticos, código sem uso e o que mudou entre versões. Seu código não sai da sua máquina.

[![CI](https://github.com/engviniciusbs/archviewer/actions/workflows/core.yml/badge.svg)](https://github.com/engviniciusbs/archviewer/actions/workflows/core.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

**[Experimente → archviewer.viniciusbsarmento.com](https://archviewer.viniciusbsarmento.com)** · [Read in English](README.md)

![O ArchViewer analisando o próprio app web: o grafo está colorido por fan-in, e o arquivo selecionado, graph-store.ts, mostra 21 dependentes e 12 imports](docs/assets/screenshot.png)

Abra a pasta de um projeto e o ArchViewer desenha as pastas, os arquivos e os imports como um grafo que você expande, recolhe e pesquisa. Um núcleo em Rust compilado para WebAssembly faz a análise no navegador. Sem instalar nada, sem conta, sem upload.

## Recursos

**Explorar**

- **Grafo interativo**: renderizado em WebGL com Sigma.js. As pastas começam recolhidas e se expandem sob demanda, então projetos com milhares de arquivos continuam legíveis.
- **Explorador, busca e detalhes**: árvore de arquivos, busca por nome ou caminho e um painel com fan-in, fan-out, imports, dependentes, exports e um trecho do código.
- **Imports precisos**: o [OXC](https://oxc.rs) faz o parsing de cada arquivo, e os imports são resolvidos como a sua toolchain resolve (paths e references do `tsconfig`, `exports` do `package.json`, workspaces do pnpm/npm/yarn). Imports dinâmicos, `require` e `new URL('./worker.ts', import.meta.url)` também contam.

**Analisar**

- **Ciclos e pendências**: dependências circulares ficam destacadas, e os imports não resolvidos aparecem listados com o motivo.
- **Heatmap**: colore o grafo por fan-in, fan-out ou linhas de código para achar pontos críticos e pastas acopladas demais. Numa pasta recolhida, fan-in e fan-out contam só o que atravessa a borda dela.
- **Código sem uso**: arquivos que nenhuma entrada alcança, arquivos que só os testes usam e exports que ninguém importa. As entradas são detectadas a partir do `package.json`, do `index.html`, de rotas do Next.js, de arquivos de config, de testes e de stories.

**Comparar e compartilhar**

- **Comparar versões**: compare o projeto aberto com um JSON exportado antes ou com outra pasta (um segundo checkout). Veja arquivos novos e removidos, pacotes novos, dependências novas e removidas, ciclos novos ou resolvidos, variações de fan-in, e pinte o grafo pelo que mudou.
- **Exportar**: baixe a visão atual em PNG ou SVG, copie como diagrama Mermaid, baixe o grafo completo de arquivos em JSON ou copie um badge para o README com as contagens de arquivos e ciclos.

**E também**

- **Privado por construção**: os arquivos são lidos localmente e analisados na sua máquina. Nenhum arquivo, caminho ou métrica é enviado a lugar algum.
- **Inglês e português**: a interface segue o idioma do navegador, e um seletor troca o idioma. Um idioma novo é um arquivo a mais ([como traduzir](CONTRIBUTING.md#translating-archviewer), em inglês).

| Código sem uso | Comparar versões |
|---|---|
| ![O painel de código sem uso na fixture de testes dead-code: dois arquivos inalcançáveis, um arquivo usado só por testes e exports sem uso](docs/assets/unused.png) | ![O ArchViewer comparado com um commit anterior dele mesmo: 44 arquivos novos, dependências novas e o grafo colorido pelas mudanças](docs/assets/compare.png) |

## Como usar

1. Abra o app no Chrome ou no Edge e clique em **Abrir projeto**. Escolha a pasta raiz de um projeto JS/TS.
2. Expanda pastas no grafo ou no explorador. Selecione um nó para ver imports, dependentes e ciclos.
3. Use **Colorir por** fan-in, fan-out ou linhas para achar pontos críticos. A escolha fica na URL, então um link compartilhado abre com a mesma visão.
4. Clique em **N sem uso** na barra de status para revisar arquivos inalcançáveis e exports sem uso.
5. **Exporte** a visão como imagem ou Mermaid, ou o grafo inteiro como JSON.
6. **Compare** com um JSON ou com outra pasta para ver o que mudou.

**Acompanhar a arquitetura ao longo do tempo.** O JSON exportado é determinístico: o mesmo código sempre gera o mesmo arquivo. Exporte da branch principal (por exemplo, a cada release), guarde junto da documentação e, depois, compare uma branch de feature com ele em **Comparar → Com um JSON exportado**.

## Como funciona

```
sua pasta ──► ingest (navegador) ──► Web Worker ──► archviewer-core (Rust → WASM)
               .gitignore,                           parsing (OXC), resolve imports,
               pastas ignoradas,                     monta o grafo, acha ciclos,
               leitura em lotes                      métricas, entradas, código sem uso
                                                               │
                                                               ▼
                       Interface React ◄── grafo visível, detalhes, busca, export completo (JSON)
                       (Sigma.js / WebGL)          │
                                                   └──► compara dois exports, PNG/SVG, Mermaid
```

- Arquivos de código: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`. Configuração lida para a resolução: `package.json`, `tsconfig*.json`, `jsconfig*.json`, `pnpm-workspace.yaml`, `index.html`.
- Ficam de fora: `node_modules`, `dist`, `build`, `out`, `coverage`, pastas ocultas, o que estiver no `.gitignore` e arquivos acima de 2 MB.
- Comparar com outra pasta roda uma segunda análise num worker próprio, que é encerrado ao terminar.
- O CI confere a análise de um projeto sintético com 20 mil arquivos.

## Limitações

- **Só JavaScript e TypeScript.** Componentes `.vue` e `.svelte` ainda não são analisados ([#7](https://github.com/engviniciusbs/archviewer/issues/7)).
- **O código sem uso é heurístico.** Imports montados em tempo de execução (`import(variavel)`) não são seguidos, e convenções de frameworks além das rotas do Next.js não são reconhecidas. Qualquer pasta `pages/` conta como rotas do Next.js. Se faltar uma entrada, o painel tem um link para abrir uma issue.
- **A comparação não detecta renomeações.** Um arquivo renomeado aparece como removido mais adicionado.
- **Sem integração com o git.** Para comparar branches, exporte um JSON de uma delas ou abra um segundo checkout.

## Suporte de navegadores

| Navegador | Acesso a arquivos | Status |
|-----------|-------------------|--------|
| Chrome / Edge | File System Access API | Suporte completo |
| Firefox | Seletor de arquivos (`webkitdirectory`) | Funciona, sem acesso direto à pasta |
| Safari | Seletor de arquivos (`webkitdirectory`) | Funciona, sem acesso direto à pasta |

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Núcleo de análise | Rust 2021, parser [OXC](https://oxc.rs) 0.157 e `oxc_resolver` 11, compilado para WebAssembly com `wasm-bindgen` 0.2.130 e tipado com `tsify` |
| App web | React 19, Vite 6, TypeScript 5, zustand 5 |
| Grafo | Sigma.js 3 (WebGL), graphology, layout ForceAtlas2 num worker |
| Testes | `cargo test` com snapshots `insta`, Vitest 2 + Testing Library, Playwright |
| Monorepo | pnpm workspaces, Turborepo |

## Desenvolvimento

Requisitos: Node.js ≥ 20, pnpm ≥ 9 e Rust (stable) com o target wasm.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130   # igual à do Cargo.lock

git clone https://github.com/engviniciusbs/archviewer.git
cd archviewer
pnpm install
pnpm build:wasm                     # compila o núcleo Rust para WebAssembly
pnpm --filter @archviewer/web dev   # http://localhost:5173
```

Rode as verificações com `cargo test --workspace`, `pnpm --filter @archviewer/web test` e `pnpm --filter @archviewer/web e2e`. A lista completa, as notas para Windows e o guia de tradução estão no [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês). O deploy de produção está descrito em [docs/deploy.md](docs/deploy.md).

```
archviewer/
├── crates/archviewer-core/   # núcleo em Rust: parsing, resolução, grafo, ciclos, métricas, código sem uso, export
├── packages/core-wasm/       # wrapper wasm-bindgen com API JS tipada
├── apps/web/                 # app React + Vite + Sigma (i18n, heatmap, export, comparação)
├── fixtures/                 # projetos de exemplo usados nos testes (sample-project, monorepo-pnpm, dead-code…)
└── docs/                     # specs de design, planos, notas de deploy e screenshots
```

## Roadmap

Tudo do primeiro roadmap já foi entregue: interface em inglês, exportar e compartilhar, heatmap, código sem uso e comparação de versões. Ideias em avaliação: visão por pacote em monorepos, mais linguagens e uma CLI nativa sobre o `archviewer-core` para checagens no CI.

Acompanhe e comente na [issue de roadmap](https://github.com/engviniciusbs/archviewer/issues/8).

## Contribuindo

Issues e pull requests são bem-vindos. Procure por [`good first issue`](https://github.com/engviniciusbs/archviewer/labels/good%20first%20issue) para começar e leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um PR. Issues e PRs podem ser em português ou em inglês. O projeto segue um [Código de Conduta](CODE_OF_CONDUCT.md).

## Licença

[MIT](LICENSE)
