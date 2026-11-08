# ArchViewer Web (Plano 2 de 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever `apps/web` como uma SPA React + Vite que abre uma pasta local, alimenta o `Analyzer` WASM num worker e mostra a arquitetura como grafo WebGL (Sigma.js) navegável por pastas e pacotes, com o visual Hallmark Cobalt.

**Architecture:** O `ingest/` percorre a pasta no thread principal (respeitando pastas ignoradas e `.gitignore`) e envia lotes ao `analysis.worker`, que mantém a sessão do `Analyzer` do `@archviewer/core-wasm`. Um store Zustand guarda o resumo, o `VisibleGraph`, a expansão, a seleção e os filtros. O `renderer/` sincroniza o store com um grafo graphology desenhado pelo Sigma, roda o ForceAtlas2 no worker do próprio pacote e mantém cache de posições por id. Os componentes leem e escrevem só no store.

**Tech Stack:** React 19, Vite 6, TypeScript 5.7, Sigma.js 3 + graphology + `graphology-layout-forceatlas2` (worker) + `@sigma/node-border`, Zustand 5, `ignore` 7 (gitignore), Vitest 2 + jsdom + Testing Library, Playwright, ESLint 9 (flat) + typescript-eslint + eslint-plugin-react-hooks, skill Hallmark (tema Cobalt, escopo app).

**Spec:** `docs/superpowers/specs/2026-11-08-archviewer-replan-design.md` (seções 3, 4, 5, 6 e 7). A API consumida é a do Plano 1, Task 8 (`packages/core-wasm/src/lib.rs`, tipos em `packages/core-wasm/pkg/core_wasm.d.ts`).

## Global Constraints

- **Única fonte de tipos do domínio:** `import type { … } from '@archviewer/core-wasm'` (`FileInput`, `AddResult`, `Summary`, `Issues`, `VisibleGraph`, `VNode`, `VEdge`, `Detail`, `SearchHit`, `UnresolvedImport`). Nenhum tipo de domínio redeclarado no app.
- **WASM só no worker:** o thread principal nunca importa o valor `@archviewer/core-wasm`, só tipos. O grafo completo nunca é serializado para a UI.
- **Ids:** `number` (o `NodeId` do core). No graphology, a chave do nó é `String(id)`. O grupo raiz é `0`.
- **Pastas puladas na varredura:** os nomes de `ignoredDirs()` do core e qualquer pasta iniciada por `.`. O `.gitignore` da raiz e os aninhados valem para o seu diretório.
- **Tamanho máximo:** `2_097_152` bytes. Arquivos maiores não são lidos e entram como pulados (`tooLarge`).
- **Projeto grande:** acima de `10_000` arquivos ingeríveis, pedir confirmação antes de ler.
- **Lotes:** até `200` arquivos ou `4_194_304` bytes de conteúdo por `addFiles`, o que vier primeiro.
- **Idioma da UI:** português, em sentence case. Nunca caixa alta espaçada.
- **Hallmark (vale para todo CSS e TSX de UI):**
  - Toda cor e toda fonte vêm de tokens (`var(--…)`). Nenhuma cor literal fora de `tokens.css`, inclusive no renderer.
  - `:focus-visible` em todo controle; fallback para `prefers-reduced-motion`; nenhum `transition: all`.
  - Cobalto (`--color-accent`) só na ação primária, na seleção e em estado; menos de 5% da tela.
  - Familjen Grotesk em títulos, rótulos e botões; IBM Plex Sans no corpo; JetBrains Mono só em caminhos, specifiers e valores técnicos.
  - Controles com 32 a 40px de altura e alvo de 44px.
- **Cores do Sigma:** lidas dos tokens em runtime e convertidas para `rgb(…)`, porque o Sigma não entende `oklch`.
- **Modo:** só claro.
- **Dependências:** adicionadas com `pnpm add` na versão atual dentro do major indicado no Tech Stack; o `pnpm-lock.yaml` vai para o commit.
- **Comandos:** a partir de `D:\dev\archviewer`. O WASM precisa estar construído (`pnpm build:wasm`) antes de testar ou rodar o app.

## Review Focus

1. **Recolher um grupo que contém o nó selecionado:** a seleção passa para o grupo recolhido e o painel de detalhes não quebra. Teste no Task 4.
2. **Cliques rápidos de expandir e recolher** (respostas de `view` fora de ordem): só a resposta mais recente é aplicada. Teste no Task 4.
3. **Cancelar no meio da leitura:** nenhum `addFiles` depois do cancelamento, o worker é descartado e o app volta ao estado vazio. Teste no Task 3 (pipeline) e no Task 4 (store).
4. **`webkitdirectory` traz o nome da pasta raiz em cada caminho** (`meu-app/src/a.ts`): o prefixo é removido, e um `node_modules` aninhado nunca é lido. Teste no Task 3.
5. **Worker morre no meio da análise** (pânico no WASM ou falta de memória): as promessas pendentes rejeitam, a tela de erro aparece com "Recarregar" e o estado anterior não é misturado ao novo. Testes nos Tasks 2 e 4.

## Desvios conscientes da spec

- **Grupos no grafo:** são discos com borda (`@sigma/node-border`), não painéis de canto cortado, porque o WebGL do Sigma não desenha esse formato. O `.cut` fica para os painéis DOM.
- **Arestas de ciclo:** levam `--color-error` e ficam mais grossas, mas não tracejadas, porque o Sigma 3 não tem programa de aresta tracejada oficial.
- **"Ocultar assets":** filtra a lista de não resolvidos, porque assets nunca viram nós (spec § 4).
- **"Busca filtra a árvore":** o explorador troca a árvore pela lista de resultados enquanto há uma busca.
- **Trecho do arquivo no painel:** é lido da pasta original sob demanda, porque o core descarta o texto-fonte depois do parse.

---

## File Structure

```
apps/web/
  package.json                  # deps novas; scripts dev/build/test/lint/typecheck/e2e
  vite.config.ts                # worker es, optimizeDeps.exclude core-wasm
  vitest.config.ts              # jsdom, setup Testing Library
  eslint.config.js
  playwright.config.ts
  index.html                    # fontes do Cobalt; fallback de grade de pontos sem JS
  src/
    main.tsx
    App.tsx                     # escolhe a tela pela fase do store
    styles/tokens.css           # gerado: theme.mjs scaffold cobalt --scope app
    styles/base.css             # gerado pelo scaffold
    styles/app.css              # stamp Hallmark na linha 1; layout e componentes
    analysis/protocol.ts        # tipos das mensagens worker <-> UI
    analysis/handler.ts         # createHandler(core): lógica do worker, testável em Node
    analysis/analysis.worker.ts # carrega o WASM e liga o handler ao postMessage
    analysis/client.ts          # AnalysisClient implements AnalysisApi
    ingest/source.ts            # DirSource, fromDirectoryHandle, fromFileList, memorySource
    ingest/gitignore.ts         # GitignoreStack
    ingest/scan.ts              # scan(): varredura com pastas ignoradas e .gitignore
    ingest/read.ts              # readInto(): leitura em lotes, progresso, cancelamento
    ingest/pick.ts              # pickDirectory(): showDirectoryPicker ou webkitdirectory
    store/graph-store.ts        # createGraphStore(api) + useGraphStore
    store/selectors.ts          # renderable(graph, filters), childrenOf, explorerRows
    store/url.ts                # filtros <-> location.search
    renderer/theme.ts           # readTheme, canvasToRgb
    renderer/positions.ts       # PositionCache, placeChildren
    renderer/sync.ts            # syncGraph(graph, renderable, cache, theme)
    renderer/GraphCanvas.tsx    # Sigma + FA2 worker + reducers + eventos
    components/Toolbar.tsx
    components/Explorer.tsx
    components/DetailPanel.tsx
    components/Snippet.tsx
    components/StatusBar.tsx
    components/IssuesPanel.tsx
    components/EmptyScreen.tsx
    components/ErrorScreen.tsx
    components/LoadingScreen.tsx
    components/AsciiField.tsx
    components/field.ts         # computeField(): densidade do campo ASCII, pura
  test/                         # *.test.ts(x) espelhando src/
  e2e/app.spec.ts
.github/workflows/core.yml      # ganha os passos do web
README.md                       # como rodar o app
```

Saem: `src/components/GraphView/`, `src/hooks/`, `src/workers/parser.worker.ts`, `src/types/graph.ts`, as pastas antigas de componentes e o tema Terminal (`tokens.css`/`base.css`/`app.css` antigos), além das dependências `d3` e `@types/d3`.

---

### Task 1: Base do app (dependências, configs, tokens Cobalt)

**Files:**
- Delete: tudo listado em "Saem" acima
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/vitest.config.ts`, `apps/web/eslint.config.js`, `apps/web/src/styles/{tokens,base,app}.css`, `apps/web/test/setup.ts`, `apps/web/test/app.test.tsx`

**Interfaces:**
- Produces: dependência `"@archviewer/core-wasm": "workspace:*"`; scripts `dev`, `build`, `test`, `lint`, `typecheck`, `e2e`; tokens CSS que os Tasks 5 a 7 usam (`--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-rule`, `--color-rule-2`, `--color-accent`, `--color-accent-2`, `--color-accent-wash`, `--color-accent-deep`, `--color-error`, `--color-glyph-1..4`, `--color-graphite*`, `--font-display`, `--font-body`, `--font-outlier`, `--dur-micro`, `--dur-short`).

- [ ] **Step 1: Limpar e instalar.** Apague os arquivos de "Saem". `pnpm --filter @archviewer/web remove d3 @types/d3`. Adicione `react@19 react-dom@19 zustand@5 sigma@3 graphology graphology-types graphology-layout-forceatlas2 @sigma/node-border ignore@7` e, como dev, `vitest@2 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test eslint@9 typescript-eslint eslint-plugin-react-hooks globals`. Adicione `@archviewer/core-wasm` como `workspace:*`.

- [ ] **Step 2: Configs.**
  - `vite.config.ts`: `worker.format = 'es'`, `optimizeDeps.exclude = ['@archviewer/core-wasm']`, `build.target = 'esnext'`, alias `@` → `src`.
  - `vitest.config.ts`: ambiente `jsdom`, `setupFiles: ['test/setup.ts']` (importa `@testing-library/jest-dom/vitest`), `include: ['test/**/*.test.{ts,tsx}']`.
  - `tsconfig.json`: inclua `test` e `e2e`; tire `declaration`/`outDir`; use `noEmit`. O script `build` passa a ser `tsc --noEmit && vite build`.
  - `eslint.config.js`: typescript-eslint recommended + react-hooks (`rules-of-hooks` error, `exhaustive-deps` warn), ignorando `dist`.

- [ ] **Step 3: Tokens Cobalt via Hallmark.** Carregue a skill Hallmark (`~/.agents/skills/hallmark/SKILL.md` e `references/flow.md` § App screens) e o tema `references/themes/cobalt.md`. Rode `node ~/.agents/skills/hallmark/scripts/theme.mjs scaffold cobalt --scope app --dir apps/web/src/styles`. Se o `tokens.css` gerado não tiver `--color-error`, acrescente `--color-error: oklch(52% 0.19 27);` no bloco `:root`. Em `app.css`, a linha 1 é o stamp impresso pelo scaffold, com `theme: cobalt (by request)` e `shape: app screen`. Em `index.html`, use o `<link>` de fontes do "Build hint" do Cobalt. `main.tsx` importa `tokens.css`, `base.css` e `app.css`, nessa ordem.

- [ ] **Step 4: Teste de fumaça.** `test/app.test.tsx`: `render(<App />)` mostra um heading com o texto `ArchViewer`. Por enquanto o `App` é só esse heading.

- [ ] **Step 5: Verificar.**
  - `pnpm build:wasm` (precisa do toolchain; veja o README).
  - `pnpm --filter @archviewer/web typecheck`, `lint` e `test` passam.
  - `pnpm --filter @archviewer/web build` gera `dist/`.

- [ ] **Step 6: Commit.** `chore(web): reset app to React+Vite+Sigma stack with Hallmark Cobalt tokens`

---

### Task 2: Worker de análise e cliente

**Files:**
- Create: `apps/web/src/analysis/{protocol,handler,client}.ts`, `apps/web/src/analysis/analysis.worker.ts`
- Test: `apps/web/test/analysis/handler.test.ts` (ambiente `node`, comentário `// @vitest-environment node`), `apps/web/test/analysis/client.test.ts`

**Interfaces:**
- Consumes: `@archviewer/core-wasm` (`default init`, `Analyzer`, `ignoredDirs`, `isIngestible`).
- Produces:

```ts
// client.ts
export interface FinishResult { summary: Summary; issues: Issues; defaultExpansion: number[] }
export interface AnalysisApi {
  ignoredDirs(): Promise<string[]>;
  start(projectName: string): Promise<void>;        // descarta a sessão anterior e cria um Analyzer novo
  filterIngestible(paths: string[]): Promise<boolean[]>;
  addFiles(batch: FileInput[]): Promise<AddResult>;
  finish(): Promise<FinishResult>;
  view(expanded: number[]): Promise<VisibleGraph>;
  detail(id: number): Promise<Detail | null>;
  find(query: string, limit: number): Promise<SearchHit[]>;
  onCrash(cb: (message: string) => void): () => void; // devolve unsubscribe
  dispose(): void;                                   // encerra o worker; pendentes rejeitam
}
export class AnalysisClient implements AnalysisApi { constructor(worker: WorkerLike) }
export function createAnalysisClient(): AnalysisClient; // new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
export class WorkerCrashedError extends Error {}
export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;

// protocol.ts
export type Method = 'ignoredDirs' | 'start' | 'filterIngestible' | 'addFiles' | 'finish' | 'view' | 'detail' | 'find';
export type Request = { id: number; method: Method; args: unknown[] };
export type Response = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

// handler.ts
export type CoreModule = Pick<typeof import('@archviewer/core-wasm'), 'Analyzer' | 'ignoredDirs' | 'isIngestible'>;
export function createHandler(core: CoreModule): (method: Method, args: unknown[]) => unknown;
```

- O `detail` traduz o `undefined` do WASM para `null`. `finish` devolve `summary`, `issues()` e `defaultExpansion()` numa só resposta.
- `start` chama `free()` na sessão anterior.
- Qualquer método antes de `start` lança `Error('sessão não iniciada')`.
- O worker responde `{ ok: false, error: e.message }` para exceções. Um evento `error` ou `messageerror` do worker é crash: todas as pendentes rejeitam com `WorkerCrashedError` e os callbacks de `onCrash` disparam uma vez.

- [ ] **Step 1: Testes do handler (falham).** Carregue o WASM como no `packages/core-wasm/test/analyzer.test.ts` (`init({ module_or_path: bytes })`) e use os arquivos de `fixtures/sample-project`.
  - `start` + `addFiles` + `finish`: `summary` com `{ files: 8, cycles: 1, externals: 2 }` e `defaultExpansion` contendo `0`.
  - `filterIngestible(['src/a.ts','README.md','node_modules/x.js'])` dá `[true,false,false]`.
  - `detail(999999)` dá `null`.
  - `view` antes de `start` lança `sessão não iniciada`.
  - Um segundo `start` zera a sessão: um `finish` logo depois dá `files: 0`.

- [ ] **Step 2: Testes do cliente (falham)** com um `FakeWorker` que guarda as mensagens e responde manualmente.
  - Respostas fora de ordem resolvem a promessa certa pelo `id`.
  - `{ ok:false }` rejeita com a mensagem.
  - Um evento `error` rejeita todas as pendentes com `WorkerCrashedError` e chama `onCrash` uma vez.
  - Depois de `dispose()`, chamadas rejeitam e o `terminate` foi chamado.

- [ ] **Step 3: Implementar** `protocol.ts`, `handler.ts`, `client.ts` e `analysis.worker.ts`. O worker faz `await init()` (URL padrão do pacote) antes de tratar a primeira mensagem. Se o `init` falhar, todas as mensagens respondem com erro `falha ao carregar o WASM: …`.

- [ ] **Step 4: Verificar.** `pnpm --filter @archviewer/web test -- analysis` passa.

- [ ] **Step 5: Commit.** `feat(web): analysis worker hosting the WASM Analyzer and a typed client`

---

### Task 3: Ingestão (fontes, `.gitignore`, varredura, leitura em lotes)

**Files:**
- Create: `apps/web/src/ingest/{source,gitignore,scan,read,pick}.ts`
- Test: `apps/web/test/ingest/{gitignore,scan,read,source}.test.ts`

**Interfaces:**
- Consumes: `AnalysisApi['addFiles']` (Task 2).
- Produces:

```ts
// source.ts
export type DirEntry = { name: string; kind: 'file' | 'dir'; size: number };
export interface DirSource { name: string; list(dir: string): Promise<DirEntry[]>; read(path: string): Promise<string> }
export function fromDirectoryHandle(handle: FileSystemDirectoryHandle): DirSource;
export function fromFileList(files: ArrayLike<File>): DirSource;   // remove o 1º segmento de webkitRelativePath; name = esse segmento
export function memorySource(name: string, files: Record<string, string>): DirSource; // para testes e e2e

// gitignore.ts
export class GitignoreStack { add(dir: string, content: string): void; ignores(path: string, isDir: boolean): boolean }

// scan.ts
export type ScanFile = { path: string; size: number };
export async function scan(src: DirSource, opts: { ignoredDirs: string[]; signal?: AbortSignal }): Promise<ScanFile[]>;

// read.ts
export type IngestSkip = { path: string; reason: 'tooLarge' | 'unreadable' };
export type ReadProgress = { read: number; total: number };
export async function readInto(
  src: DirSource, files: ScanFile[], addFiles: (b: FileInput[]) => Promise<AddResult>,
  opts: { maxFileBytes: number; batchFiles: number; batchBytes: number; signal?: AbortSignal; onProgress?: (p: ReadProgress) => void },
): Promise<{ accepted: number; skipped: IngestSkip[] }>;

// pick.ts
export async function pickDirectory(): Promise<{ source: DirSource; fallback: boolean } | null>; // null se o usuário cancelar
```

- Caminhos em `/`, relativos à raiz, sem `./`. `scan` não desce em pasta ignorada (pelos nomes de `ignoredDirs`, por iniciar com `.` ou por `.gitignore`). Ela lê o `.gitignore` de cada diretório antes de listar os filhos e devolve os arquivos em ordem estável (ordenados por caminho).
- O cancelamento lança `DOMException('cancelado', 'AbortError')`. `readInto` checa o sinal antes de cada leitura e antes de cada `addFiles`.

- [ ] **Step 1: Testes (falham).**
  - `gitignore`:
    - `add('', 'dist\n*.log\n!keep.log')`: ignora `dist` (dir) e `a.log`, mas não `keep.log`.
    - `add('pkg', 'gen/')`: ignora `pkg/gen` (dir), mas não `gen` na raiz.
  - `scan` com `memorySource`:
    - pula `node_modules/x.js`, `pkg/node_modules/y.js`, `.git/z.js` e `.cache/a.ts`;
    - respeita `.gitignore` na raiz e aninhado;
    - nunca chama `list` numa pasta ignorada (espione `list`);
    - aborta com `AbortError` quando o sinal já está abortado.
  - `fromFileList`: arquivos com `webkitRelativePath` `meu-app/src/a.ts` e `meu-app/package.json` viram `src/a.ts` e `package.json`; `name` é `meu-app`; `list('src')` traz `a.ts`.
  - `readInto`:
    - 450 arquivos com `batchFiles: 200` geram lotes de 200, 200 e 50;
    - `batchBytes` corta antes de 200;
    - um arquivo com `size > maxFileBytes` não é lido e vira `tooLarge`;
    - um `read` que lança vira `unreadable`;
    - `onProgress` termina em `{ read: total, total }`;
    - abortar depois do primeiro lote gera zero `addFiles` adicionais e rejeita com `AbortError`.

- [ ] **Step 2: Implementar.**
  - `GitignoreStack` usa o pacote `ignore`, uma instância por diretório e caminhos relativos ao diretório do arquivo.
  - `fromDirectoryHandle` guarda os handles de diretório por caminho para `list`/`read`.
  - `pickDirectory` usa `window.showDirectoryPicker({ mode: 'read' })` quando existe. Senão, cria um `<input type=file webkitdirectory multiple>` e devolve `fallback: true`. `AbortError` do picker vira `null`.

- [ ] **Step 3: Verificar.** `pnpm --filter @archviewer/web test -- ingest` passa.

- [ ] **Step 4: Commit.** `feat(web): ingest with ignored dirs, nested .gitignore, batched reads and cancel`

---

### Task 4: Store do grafo (Zustand), seletores e filtros na URL

**Files:**
- Create: `apps/web/src/store/{graph-store,selectors,url}.ts`
- Test: `apps/web/test/store/{graph-store,selectors,url}.test.ts`

**Interfaces:**
- Consumes: `AnalysisApi`, `FinishResult` (Task 2); `DirSource`, `scan`, `readInto`, `IngestSkip`, `ReadProgress` (Task 3).
- Produces:

```ts
export type Phase = 'empty' | 'scanning' | 'confirm' | 'reading' | 'analyzing' | 'ready' | 'error';
export type Filters = { hideExternals: boolean; hideTypeOnly: boolean; hideAssets: boolean; cyclesOnly: boolean };
export interface GraphState {
  phase: Phase; error: string | null; projectName: string | null; fallback: boolean;
  source: DirSource | null; pendingCount: number;          // pendingCount: arquivos aguardando confirmação
  progress: ReadProgress | null; elapsedMs: number | null;
  summary: Summary | null; issues: Issues | null; ingestSkipped: IngestSkip[];
  graph: VisibleGraph; expanded: number[]; selected: number | null; detail: Detail | null;
  filters: Filters; focusRequest: { id: number; seq: number } | null;
  openProject(source: DirSource, fallback: boolean): Promise<void>;
  confirmLarge(proceed: boolean): void;
  cancel(): void;
  toggle(id: number): Promise<void>;   // expande se recolhido e expansível; recolhe se expandido
  select(id: number | null): Promise<void>; // carrega o detail
  reveal(hit: SearchHit): Promise<void>; // expande ancestors, seleciona, emite focusRequest
  setFilter<K extends keyof Filters>(k: K, v: boolean): void;
  reset(): void;
}
export function createGraphStore(deps: { api: () => AnalysisApi; now?: () => number }): StoreApi<GraphState>;
export const defaultStore: StoreApi<GraphState>;            // createGraphStore({ api: createAnalysisClient })
export function GraphStoreProvider(p: { store: StoreApi<GraphState>; children: ReactNode }): JSX.Element;
export function useGraphStore<T>(selector: (s: GraphState) => T): T; // store do contexto; sem provider, defaultStore
export function useGraphStoreApi(): StoreApi<GraphState>;            // para o renderer assinar fora do ciclo do React

// selectors.ts
export type Renderable = { nodes: VNode[]; edges: VEdge[] };
export function renderable(graph: VisibleGraph, filters: Filters): Renderable;
export type ExplorerRow = { node: VNode; depth: number };
export function explorerRows(graph: VisibleGraph): ExplorerRow[]; // pré-ordem a partir dos filhos da raiz, por label; externos no fim, depth 0
export function visibleUnresolved(issues: Issues, filters: Filters): UnresolvedImport[];

// url.ts
export function readFilters(search: string): Filters;     // ?hide=externals,typeOnly,assets&cycles=1
export function writeFilters(f: Filters): string;          // '' quando tudo é padrão (false)
```

- **`openProject`:**
  - `api()` cria um cliente novo; o anterior recebe `dispose()`.
  - Sequência: `start(source.name)` → `ignoredDirs` → `scan` → `filterIngestible`.
  - Acima de `10_000` arquivos, entra em `phase 'confirm'` com `pendingCount` e espera `confirmLarge`.
  - Depois: `readInto` (lotes 200 / 4 MiB, `maxFileBytes` 2_097_152) → `finish` → `view(defaultExpansion)` → `ready`.
  - `elapsedMs` mede do início ao `ready`.
- **Cancelamento e erros:** `cancel()` aborta o sinal, chama `dispose()` e faz `reset()`; o `AbortError` não vira erro. `onCrash` ou outra exceção levam a `phase 'error'` com a mensagem.
- **`renderable`:**
  - tira os nós com `expanded: true`;
  - `hideExternals` tira os nós `external` e suas arestas;
  - `hideTypeOnly` tira as arestas `typeOnly`;
  - `cyclesOnly` mantém só nós e arestas com `inCycle`;
  - nenhuma aresta fica apontando para um nó removido.
- **`hideAssets`** age só sobre a lista de não resolvidos (`visibleUnresolved`), porque assets nunca são nós.
- **Concorrência:** cada `view`/`detail` leva um número de sequência; uma resposta com número menor que o último pedido é descartada.
- **Seleção:** depois de recolher, se o selecionado não está mais em `graph.nodes`, a seleção passa para o grupo recolhido (e o `detail` é recarregado).
- **URL:** os filtros iniciais vêm de `readFilters(location.search)`, e `setFilter` faz `history.replaceState` com `writeFilters`.

- [ ] **Step 1: Testes (falham).** Use uma `FakeApi` em memória com um `VisibleGraph` pequeno e respostas controláveis (promessas que o teste resolve).
  - `openProject` com `memorySource` de 3 arquivos passa por `scanning → reading → analyzing → ready`, com `graph` vindo de `view(defaultExpansion)`.
  - Com 10_001 arquivos fica em `confirm`; `confirmLarge(false)` volta a `empty` sem chamar `addFiles`.
  - `toggle` de um grupo recolhido chama `view` com o id somado a `expanded`; um segundo `toggle` chama `view` sem ele.
  - **Corrida:** dois `toggle` seguidos com a primeira resposta chegando por último deixam o `graph` da segunda.
  - **Seleção após recolher:** selecione um arquivo dentro do grupo 5 e recolha o 5; `selected` vira `5` e `detail` foi pedido para `5`.
  - `reveal({ id: 9, ancestors: [0, 5, 7], … })` deixa `expanded` com 5 e 7 incluídos, `selected` 9 e `focusRequest.id` 9.
  - `cancel()` durante `reading` leva a `empty`, chama `dispose` e não deixa erro.
  - `onCrash('boom')` durante `analyzing` leva a `error` com `boom`.
  - `renderable`, `explorerRows` e `url`: um caso por regra acima. Para a URL, a ida e volta de `readFilters(writeFilters(f))` devolve o mesmo `f`.

- [ ] **Step 2: Implementar** os três arquivos.

- [ ] **Step 3: Verificar.** `pnpm --filter @archviewer/web test -- store` passa.

- [ ] **Step 4: Commit.** `feat(web): graph store with expansion, selection, filters and stale-response guard`

---

### Task 5: Renderer (Sigma, layout em worker, cache de posições, tema)

**Files:**
- Create: `apps/web/src/renderer/{theme,positions,sync}.ts`, `apps/web/src/renderer/GraphCanvas.tsx`
- Test: `apps/web/test/renderer/{theme,positions,sync}.test.ts`

**Interfaces:**
- Consumes: `Renderable`, `renderable` (Task 4); `useGraphStore` (`graph`, `filters`, `selected`, `focusRequest`, `toggle`, `select`).
- Produces:

```ts
// theme.ts
export interface GraphTheme { paper: string; paper2: string; ink: string; ink2: string; muted: string; rule: string; rule2: string; accent: string; accentWash: string; error: string; labelFont: string }
export function readTheme(root: Element, toRgb: (css: string) => string): GraphTheme; // getComputedStyle(root).getPropertyValue('--color-…')
export function canvasToRgb(css: string): string; // canvas 1x1: fillStyle + fillRect + getImageData → 'rgb(r, g, b)'

// positions.ts
export class PositionCache { get(id: number): { x: number; y: number } | undefined; set(id: number, x: number, y: number): void; capture(g: Graph): void }
export function placeChildren(parent: { x: number; y: number }, childIds: number[]): Map<number, { x: number; y: number }>;

// sync.ts
export function syncGraph(g: Graph, r: Renderable, cache: PositionCache, theme: GraphTheme): { added: number[]; removed: number[] };

// GraphCanvas.tsx
export function GraphCanvas(): JSX.Element;
```

- **`syncGraph`:**
  - **Diferença:** remove nós e arestas que saíram, guardando a posição deles no cache antes; adiciona os novos; atualiza os atributos dos que ficaram, sem mexer em `x`/`y`.
  - **Posição de um nó novo:** primeiro o próprio cache. Se não houver, `placeChildren` em volta da posição em cache do `parentId` (os irmãos novos com o mesmo pai são posicionados juntos). Sem pai em cache, a origem.
  - **Raio de `placeChildren`:** `10 + 4 * sqrt(n)`. Ângulos igualmente espaçados a partir de um deslocamento determinístico pelo menor id. Mesma entrada, mesma saída.
- **Atributos visuais:**
  - **Grupo:** tipo `border`, `size = clamp(6 + 2*sqrt(size), 6, 28)`, `color = paper2`, `borderColor = rule2`.
  - **Arquivo:** `size = clamp(3 + sqrt(size)/2, 3, 10)`, `color = ink2`.
  - **Externo:** tipo `border`, `color = paper`, `borderColor = muted`.
  - **Aresta:** `size = clamp(1 + log2(weight), 1, 6)`. `color = error` se `inCycle`, senão `rule2`. `typeOnly` usa `muted`.
  - `label = node.label`.
- **Layout:**
  - `FA2Layout` de `graphology-layout-forceatlas2/worker`, configurações de `forceAtlas2.inferSettings(g)`.
  - Na primeira carga, todos os nós ficam livres e o layout roda `2000ms`.
  - Depois de cada sync com nós adicionados, os nós antigos recebem `fixed: true`, o layout roda `800ms`, e no fim todos voltam a `fixed: false`.
  - Ao parar, `cache.capture(g)`.
  - Mudar seleção ou foco nunca reinicia o layout.
- **Interação:**
  - `clickNode` chama `select(id)`; `clickStage` chama `select(null)`.
  - `doubleClickNode` chama `preventSigmaDefault()` e depois `toggle(id)` se o nó for `expandable` ou `expanded`.
  - `nodeReducer`/`edgeReducer` leem a seleção de um `ref`. Com seleção, os nós fora do selecionado e dos vizinhos diretos ficam com cor `rule` e sem label, e as arestas fora ficam ocultas. O selecionado recebe `color = accent` (borda `accent` em grupos). Depois, `sigma.refresh()`.
  - Um novo `focusRequest` anima a câmera até o nó em `--dur-short`, ou sem animação sob `prefers-reduced-motion`.
  - Rótulos por zoom: `labelRenderedSizeThreshold: 8`, `labelFont` vindo de `--font-body`, `labelColor: { color: theme.ink }`.

- [ ] **Step 1: Testes (falham), ambiente node, com `graphology` real.**
  - `readTheme` com um elemento falso cujo `getComputedStyle` devolve valores `oklch(…)` e um `toRgb` espião: todas as chaves vêm pelo `toRgb`, e `labelFont` vem de `--font-body` sem conversão.
  - `placeChildren({x:0,y:0},[3,1,2])` é determinística, dá três pontos distintos à distância `10 + 4*sqrt(3)`, e trocar a ordem da entrada não muda o resultado por id.
  - `syncGraph`:
    - a primeira chamada adiciona tudo;
    - **expandir:** o grupo 5 some e os filhos 6 e 7 aparecem em volta da última posição de 5;
    - **recolher:** 6 e 7 saem, guardando posições, e 5 volta à posição de antes;
    - **expandir de novo:** 6 e 7 voltam às posições guardadas;
    - uma aresta `inCycle` recebe `color = theme.error`;
    - atualizar sem mudança devolve `added` e `removed` vazios e não altera `x`/`y`.

- [ ] **Step 2: Implementar** `theme.ts`, `positions.ts` e `sync.ts` até os testes passarem.

- [ ] **Step 3: Implementar `GraphCanvas.tsx`.**
  - Um `<div>` que ocupa a área central.
  - No mount: `readTheme(document.documentElement, canvasToRgb)`, cria `Graph` (multi: false, type: 'directed') e `Sigma` com `nodeProgramClasses: { border: NodeBorderProgram }`.
  - Liga eventos e reducers e assina o store.
  - No unmount: `kill()` do layout e do Sigma.

- [ ] **Step 4: Verificar.** `pnpm --filter @archviewer/web test -- renderer` e `typecheck` passam.

- [ ] **Step 5: Commit.** `feat(web): Sigma renderer with FA2 worker layout, position cache and token colors`

---

### Task 6: Telas e componentes (shell, explorador, detalhes, status, estados)

**Files:**
- Create: `apps/web/src/components/{Toolbar,Explorer,DetailPanel,Snippet,StatusBar,IssuesPanel,EmptyScreen,ErrorScreen}.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/styles/app.css`
- Test: `apps/web/test/components/{Toolbar,Explorer,DetailPanel,StatusBar,App}.test.tsx`

**Interfaces:**
- Consumes: `useGraphStore`, `GraphStoreProvider` e seletores (Task 4); `pickDirectory` (Task 3); `GraphCanvas` (Task 5). Nos testes, monte com `<GraphStoreProvider store={createGraphStore({ api: () => fakeApi })}>`. O `GraphCanvas` é substituído por um stub via `vi.mock`, porque o jsdom não tem WebGL.
- **Texto da barra de status** (o e2e depende dele), com plural correto e `Intl.NumberFormat('pt-BR')`:
  - itens: `8 arquivos · 12 arestas · 1 ciclo · 2 externos · 1 não resolvido · 0 ignorados · 0,4 s`
  - singular e plural: `1 arquivo`/`N arquivos`, `1 aresta`, `1 ciclo`, `1 externo`, `1 não resolvido`, `1 ignorado`
  - "não resolvidos" é um botão
- Produces: `App` que escolhe a tela pela `phase`. `empty` → `EmptyScreen`; `scanning`/`confirm`/`reading`/`analyzing` → `LoadingScreen` (Task 7; até lá, um placeholder com o texto de progresso); `ready` → shell; `error` → `ErrorScreen`.

- [ ] **Step 1: Carregar a Hallmark.** Siga o modo App screens: Picks com `Screen · grafo de arquitetura com explorador e painel de detalhes · states: empty, loading, error, full`. A **assinatura** é o painel de detalhes, com fan-in/fan-out como números grandes em Familjen 600 e algarismos tabulares. Siga a "Tradução do tema para o app" da spec § 5.

- [ ] **Step 2: Testes (falham).**
  - **Toolbar:**
    - "Abrir projeto" é o único `.key--primary`.
    - As quatro teclas de filtro ("Ocultar externos", "Ocultar só tipos", "Ocultar assets", "Só ciclos") alternam `aria-pressed` e chamam `setFilter`.
    - Digitar na busca chama `find` (debounce de 150ms, use fake timers) e lista os resultados.
    - Escolher um resultado chama `reveal`.
  - **Explorer:**
    - Renderiza `explorerRows` como `role="tree"`, com `aria-expanded` nos grupos.
    - Clicar num grupo expansível chama `toggle`; clicar numa linha chama `select`.
    - A linha selecionada tem `aria-selected="true"`.
    - Com uma busca ativa, mostra a lista de resultados no lugar da árvore.
  - **DetailPanel:**
    - Para `kind: 'file'`: caminho em mono; `fanIn`/`fanOut` como números; imports e dependentes como botões que chamam `reveal`/`select`; erros de parse com linha:coluna; aviso de ciclo quando `cycle` não está vazio.
    - Para `group`: `fileCount`, `loc` e as listas `topOutgoing`/`topIncoming`.
    - Para `external`: nome e `importedBy`.
    - Sem seleção: o estado vazio "Selecione um nó no grafo ou no explorador".
  - **Snippet:**
    - Lê `source.read(path)` e mostra as primeiras 40 linhas num `.graphite`.
    - As linhas que contêm um specifier de `detail.imports` recebem a classe de destaque.
    - Uma falha de leitura mostra "Não foi possível ler o arquivo".
  - **StatusBar em `ready`:**
    - Mostra arquivos, arestas, ciclos, não resolvidos, ignorados (`summary.skipped + ingestSkipped.length`) e tempo.
    - Clicar em "não resolvidos" abre o `IssuesPanel` (disclosure inline, não modal) com `from`, `specifier` e motivo traduzido (`notFound` → "não encontrado", `asset` → "asset", `unknownAlias` → "alias desconhecido").
    - Respeita `hideAssets`.
    - Lista os `warnings`.
  - **App:**
    - `phase 'empty'` mostra a `EmptyScreen` com uma ação "Abrir projeto" e a nota de navegadores.
    - `phase 'error'` mostra a mensagem e um botão "Recarregar" que chama `location.reload` (espião).
    - Com `fallback: true` aparece o aviso discreto "Seu navegador não tem acesso direto a pastas; usando o seletor de arquivos.".

- [ ] **Step 3: Implementar componentes e `app.css`.**
  - **Layout:** grid com toolbar no topo, explorador (280px) à esquerda, grafo ao centro, detalhes (360px) à direita e barra de status embaixo.
  - **Superfícies:** painéis `.cut` sobre `--color-paper-2`; teclas `.key`; bandeja de filtros em `--color-paper-3`, com a tecla ativa afundada.
  - **Status:** texto com um ícone.
  - Abaixo de 60rem, o explorador e os detalhes viram painéis recolhíveis.

- [ ] **Step 4: Verificar.**
  - `pnpm --filter @archviewer/web test`, `typecheck` e `lint` passam.
  - Com `pnpm --filter @archviewer/web dev` rodando, `node ~/.agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/app.css --scope app --genre modern-minimal --render --url http://localhost:5173/` termina sem FAIL. REFLEX é corrigido ou recebe `waive` no stamp.

- [ ] **Step 5: Log do Hallmark.** Rode `node ~/.agents/skills/hallmark/scripts/theme.mjs log --entry '<json>' --log .hallmark/log.json`, com `theme: "cobalt"`, `scope: "app"`, `shape: "app screen"`, `signature` e `prompt`.

- [ ] **Step 6: Commit.** `feat(web): app shell, explorer, detail panel, status bar and empty/error states`

---

### Task 7: Tela de leitura com campo ASCII e confirmação de projeto grande

**Files:**
- Create: `apps/web/src/components/{field.ts,AsciiField.tsx,LoadingScreen.tsx}`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/styles/app.css`, `apps/web/index.html`
- Test: `apps/web/test/components/{field,LoadingScreen}.test.ts(x)`

**Interfaces:**
- Consumes: `phase`, `progress`, `pendingCount`, `confirmLarge`, `cancel` (Task 4); tokens `--color-glyph-1..4`, `--color-accent-deep`, `--font-outlier`.
- Produces:

```ts
// field.ts
export const RAMP = ' .:-=+*#%@';
export function computeField(cols: number, rows: number, p: { ratio: number; t: number }): Uint8Array; // nível 0..9 por célula, linha a linha
export function levelColor(level: number): 0 | 1 | 2 | 3 | 4 | 5; // 0 = vazio, 1..4 = --color-glyph-1..4, 5 = --color-accent-deep
```

- **`computeField`:**
  - A fronteira fica na coluna `floor(ratio * cols)`.
  - **À esquerda ("resolvido"):** padrão regular e estável, em níveis médios, que não varia com `t`.
  - **À direita ("cru"):** ruído determinístico, função hash de `(col, row, floor(t*30))`.
  - **Densidade:** a fração de células não vazias cresce com `ratio`.
  - Só a faixa de 2 colunas na fronteira usa o nível 9 (accent-deep), e nenhum texto fica sobre ela.
- **`AsciiField`:**
  - Canvas com células de 8×16 e `JetBrains Mono` (`--font-outlier`), cores via `readTheme`-style a partir dos tokens de glyph (`canvasToRgb`).
  - Roda a 30 fps com `requestAnimationFrame` limitado e pausa via `IntersectionObserver` e `document.hidden`.
  - Sob `prefers-reduced-motion`, desenha um quadro só.
  - `aria-hidden="true"`.
- **Sem JavaScript:** em `index.html`, `#root` tem um fundo de grade de pontos no passo da célula, só com CSS (o `<noscript>` explica que o app precisa de JavaScript).
- **`LoadingScreen`:**
  - `scanning`: "Procurando arquivos…".
  - `reading`: "Lendo 1.234 de 5.678 arquivos", com `Intl.NumberFormat('pt-BR')` e uma barra `role="progressbar"`.
  - `analyzing`: "Analisando imports…".
  - Botão "Cancelar" chama `cancel`.
  - `confirm`: "Este projeto tem 12.345 arquivos de código. Ler mesmo assim?", com "Ler projeto" (primária) e "Cancelar".

- [ ] **Step 1: Testes (falham).**
  - **`computeField`:**
    - mesmo `(cols, rows, ratio, t)` dá o mesmo resultado;
    - com `ratio 0` a metade esquerda está vazia;
    - a contagem de células não vazias com `ratio 0.8` é maior que com `0.2`;
    - a região à esquerda da fronteira não muda entre `t = 0` e `t = 1`;
    - o nível 9 só aparece nas 2 colunas da fronteira.
  - **`LoadingScreen`:** os textos de cada fase acima; "Cancelar" chama `cancel`; em `confirm`, "Ler projeto" chama `confirmLarge(true)`.

- [ ] **Step 2: Implementar** e ligar no `App`, trocando o placeholder do Task 6.

- [ ] **Step 3: Verificar.** Testes, `typecheck`, `lint` e o mesmo `sloplint --scope app` do Task 6 passam.

- [ ] **Step 4: Commit.** `feat(web): loading screen with a progress-driven ASCII field and large-project confirm`

---

### Task 8: Ponta a ponta, CI e README

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/app.spec.ts`
- Modify: `.github/workflows/core.yml`, `README.md`, `apps/web/package.json` (script `e2e`)

**Interfaces:**
- Consumes: o app inteiro; `fixtures/sample-project`.

- [ ] **Step 1: Configurar o Playwright.** Use o projeto `chromium` e `webServer` com `pnpm build && pnpm preview --port 4173`. Defina `baseURL` e `reuseExistingServer: !process.env.CI`.

- [ ] **Step 2: Escrever o e2e `app.spec.ts`.**
  - `page.addInitScript(() => { delete (window as any).showDirectoryPicker; })`, para forçar o caminho `webkitdirectory`.
  - Clique em "Abrir projeto", capture o evento `filechooser` e chame `setFiles(<abs>/fixtures/sample-project)`.
  - Espere a barra de status mostrar `8 arquivos` e `1 ciclo`. Confira o aviso de fallback.
  - No explorador, os grupos de topo do sample-project aparecem.
  - Expanda um grupo pelo explorador; os filhos aparecem com `aria-expanded="true"` no pai.
  - Selecione o arquivo `lazy.ts` pela busca. O painel mostra o caminho, fan-in/fan-out e dois imports `dynamic`.
  - Clique em "não resolvidos". A lista mostra 1 item com motivo "asset", e "Ocultar assets" o esconde.
  - Nenhum erro no console (`page.on('pageerror')` falha o teste).

- [ ] **Step 3: Verificar localmente.**
  - `pnpm --filter @archviewer/web exec playwright install chromium`
  - `pnpm --filter @archviewer/web e2e` passa.
  - O `sloplint --scope app --render --url http://localhost:4173/` termina sem FAIL.

- [ ] **Step 4: CI.** Em `core.yml`, renomeie `name` para `ci`. Depois do passo do core-wasm, acrescente:
  - `pnpm --filter @archviewer/web typecheck`
  - `pnpm --filter @archviewer/web lint`
  - `pnpm --filter @archviewer/web test`
  - `pnpm --filter @archviewer/web exec playwright install --with-deps chromium`
  - `pnpm --filter @archviewer/web e2e`

- [ ] **Step 5: README.** Inclua:
  - seção "Rodar o app": `pnpm install`, `pnpm build:wasm`, `pnpm --filter @archviewer/web dev`;
  - suporte de navegadores (Chrome/Edge completos; Firefox/Safari via seletor de arquivos);
  - privacidade: nada sai do navegador.

- [ ] **Step 6: Commit.** `test(web): Playwright e2e on sample-project; CI runs web checks and e2e`
