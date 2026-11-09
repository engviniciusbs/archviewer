# Metrics, Heatmap and Dead Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Métricas por nó com heatmap na visão, e detecção de arquivos e exports sem uso a partir de entradas heurísticas.

**Architecture:** No núcleo Rust, `view()` passa a calcular `metrics` e um novo módulo `dead.rs` roda no `finish`, guardando o uso de cada arquivo. A web ganha o estado `colorBy`, uma escala de quantis (`renderer/heat.ts`), cores no `syncGraph`, uma legenda, o painel de código morto e um selo no detalhe.

**Tech Stack:** Rust (oxc_resolver, serde, tsify, insta), React 19, zustand, Sigma 3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-metrics-dead-code-design.md`

## Global Constraints

- Nenhuma dependência nova.
- Cinco faixas de heatmap, com cortes nos quantis 0,2, 0,4, 0,6 e 0,8 dos nós desenhados. As cores são os tokens `--color-heat-1` a `--color-heat-5`, `--color-unused` e `--color-test-only`, e precisam ser validadas com a skill `dataviz` antes da Task 3.
- Os valores de URL e de `colorBy` são `none`, `fanIn`, `fanOut`, `loc` e `unused`.
- Os motivos de entrada são `packageJson`, `script`, `html`, `framework`, `config`, `test`, `story` e `declaration`, nessa ordem de precedência.
- O JSON exportado ganha `deadCode`, e `version` continua 1.
- Todo texto de interface vai para `en` e `pt-BR`.

## Review Focus

1. **`package.json` com `exports` profundamente aninhado ou com padrões `./*`**: as folhas com `*` são ignoradas e não podem quebrar a análise. Teste na Task 2.
2. **`index.html` com `<script>` sem `src`, com `src` externo (`https://…`) ou com aspas simples**: o arquivo é ignorado, ou casado só quando é local. Teste na Task 2.
3. **Barrel com ciclo de `export *`** (A reexporta B, que reexporta A): a busca termina e não entra em laço. Teste na Task 2.
4. **Heatmap com todos os valores iguais ou todos zero**: aparece uma única faixa, sem divisão por zero, e a legenda mostra um único intervalo. Teste na Task 3.
5. **Trocar `colorBy` com um nó selecionado**: o destaque da seleção continua por cima da cor do heatmap. Coberto pelo uso dos reducers; o teste de `syncGraph` confere que a cor-base muda e o reducer não.

---

### Task 1: `metrics` em `view()`

**Files:** `crates/archviewer-core/src/model.rs` (`NodeMetrics`; o campo `metrics` em `VNode`), `src/view.rs`; teste em `tests/fixtures.rs` (snapshots atualizados) e em `apps/web/test/components/helpers.tsx` (o `vnode` ganha `metrics` com zeros).

**Interfaces:** `NodeMetrics { fan_in: u32, fan_out: u32, loc: u32, unused: u32 }`, em camelCase no TS. O campo `unused` fica 0 até a Task 2.

- [ ] **Step 1:** teste `view_metrics` na fixture `sample-project`:
  - com tudo expandido, `src/circular/a.ts` tem `fanIn` e `fanOut` iguais aos do `detail` e `loc` igual a 11;
  - na visão padrão, o grupo recolhido `src/circular` tem `fanIn` igual ao número de arquivos de fora que importam a ou b, e `fanOut` que não conta a aresta a ↔ b;
  - `react` tem `fanIn` maior ou igual a 1 e `fanOut` igual a 0.
- [ ] **Step 2:** o teste falha (campo inexistente).
- [ ] **Step 3:** implementar no `view()` a partir dos representantes:
  - para cada aresta de arquivo, pega `rep(from)` e `rep(to)`; se forem iguais, ignora;
  - senão, insere `from` (o arquivo) no conjunto de fan-in de `rep(to)` e `to` no conjunto de fan-out de `rep(from)`;
  - `loc` soma de baixo para cima, como `files_below`.
- [ ] **Step 4:** rodar `cargo test --workspace` (revisar o diff dos snapshots: só deve aparecer `metrics`), `pnpm build:wasm`, o typecheck da web e o vitest. Corrigir os helpers.
- [ ] **Step 5:** commit `feat(core): fan-in, fan-out and lines per visible node`.

### Task 2: código morto no núcleo, no WASM, no worker e no store

**Files:**
- Create: `crates/archviewer-core/src/dead.rs`, `fixtures/dead-code/**`
- Modify:
  - `paths.rs` (`is_config` inclui `index.html`);
  - `model.rs` (`EntryReason`, `FileUsage`, `EntryPoint`, `UnusedExports`, `DeadCode`; `FileDetail.{usage, entry_reason, unused_exports}`; `GraphExport.dead_code`);
  - `analyzer.rs` (calcula no `finish` e guarda `dead: Option<DeadData>`);
  - `detail.rs`, `view.rs` (`metrics.unused`), `export.rs`, `lib.rs`;
  - `packages/core-wasm/src/lib.rs` (`deadCode()`);
  - os arquivos web `analysis/protocol.ts`, `handler.ts`, `client.ts` e `store/graph-store.ts` (`deadCode` carregado junto com o `finish`, no estado `deadCode: DeadCode | null`).

**Interfaces:**
- `pub(crate) struct DeadData { pub public: DeadCode, pub usage: Vec<Option<(FileUsage, Option<EntryReason>)>>, pub unused_exports: HashMap<NodeId, Vec<String>> }`, indexado por `NodeId`.
- `pub(crate) fn analyze(g: &Graph, configs: &HashMap<String, String>, resolver: &ResolverSet) -> DeadData`
- `FinishResult` ganha `deadCode: DeadCode`, e o handler preenche com `a.deadCode()`.

**Fixture `dead-code`:**
- `package.json`:
  - `{"name":"dc","main":"src/index.ts","bin":{"dc":"bin/cli.ts"},"exports":{".":{"import":"./src/index.ts"},"./util":"./src/util/index.ts","./*":"./src/*.ts"},"scripts":{"gen":"tsx scripts/gen.ts --out dist"}}`
- `index.html`:
  - `<script type="module" src="/src/web.ts"></script><script src="https://cdn.x/y.js"></script><script>inline()</script>`
- Arquivos de código:
  - `src/index.ts`: `export * from './barrel'; export { named } from './named';`
  - `src/barrel.ts`: `export * from './a'; export * from './loop';`
  - `src/loop.ts`: `export * from './barrel'; export const l = 1;`
  - `src/a.ts`: `export const usedA = 1; export const alsoA = 2;`
  - `src/named.ts`: `export const named = 1; export const notReexported = 2;`
  - `src/web.ts`: `import { helper } from './lib/helper'; import * as ns from './lib/ns'; const m = await import('./lib/lazy'); export default helper;`
  - `src/lib/helper.ts`: `export const helper = 1; export const unusedHelper = 2; export default 3;`
  - `src/lib/ns.ts`: `export const n1 = 1;`
  - `src/lib/lazy.ts`: `export const z = 1;`
  - `src/util/index.ts`: `export const u = 1;`
  - `src/dead/a.ts`: `import { b } from './b'; export const a = b;`
  - `src/dead/b.ts`: `export const b = 1;`
  - `src/only-tests.ts`: `export const t = 1; export const tUnused = 2;`
  - `src/only-tests.test.ts`: `import { t } from './only-tests';`
  - `src/button.stories.tsx`: `export default {};`
  - `vite.config.ts`: `export default {};`
  - `bin/cli.ts`: `export {};`
  - `scripts/gen.ts`: `export {};`
  - `app/dashboard/page.tsx`: `export default function P(){}`
  - `types/global.d.ts`: `declare const X: number;`

- [ ] **Step 1: testes** (`tests/fixtures.rs::dead_code_fixture`)
  - `entries` contém, com motivo:
    - `src/index.ts` (`packageJson`), `src/util/index.ts` (`packageJson`), `bin/cli.ts` (`packageJson`);
    - `scripts/gen.ts` (`script`);
    - `src/web.ts` (`html`);
    - `app/dashboard/page.tsx` (`framework`);
    - `vite.config.ts` (`config`);
    - `src/only-tests.test.ts` (`test`);
    - `src/button.stories.tsx` (`story`);
    - `types/global.d.ts` (`declaration`).
  - `unused_files == ["src/dead/a.ts", "src/dead/b.ts"]`
  - `test_only_files == ["src/only-tests.ts"]`
  - `unused_exports` é exatamente:
    - `src/lib/helper.ts: ["unusedHelper"]`
    - `src/only-tests.ts: ["tUnused"]`
  
    Os outros arquivos não aparecem: `named`/`notReexported` porque `named.ts` só é reexportado nomeadamente por uma entrada (`notReexported` deveria aparecer; ver a ruling abaixo); `a.ts` porque é reexportado por `export *` por uma entrada via barrel; `default` porque é importado; `n1` porque vem por namespace; `lazy` porque é dinâmico.
  - `fallback == false`
  - o detalhe de `src/dead/a.ts` tem `usage == Unused`; o de `src/index.ts` tem `usage == Entry` e `entry_reason == Some(PackageJson)`
  - `view` com tudo recolhido: o grupo `src` tem `metrics.unused == 2`
  - `sample_project_fallback`: `fallback == true`, e `unused_files` são os arquivos de código sem importadores e que não são entrada.

  > **Ruling registrada:** `src/named.ts` exporta `notReexported`, e ninguém importa esse nome; o re-export nomeado só pede `named`. Então `notReexported` **aparece** em `unused_exports`. A lista esperada é: `src/lib/helper.ts: ["unusedHelper"]`, `src/named.ts: ["notReexported"]`, `src/only-tests.ts: ["tUnused"]`.
- [ ] **Step 2:** o teste falha.
- [ ] **Step 3:** implementar o `dead.rs`:
  - entradas por `package.json`: percorrer os valores, ignorar os que contêm `*`, e chamar `resolver.resolve("<dir>/package.json", "./<valor sem ./>")`; quando o resultado for `Resolution::Internal(p)` e `p` for um arquivo de código, `p` vira entrada;
  - scripts: tokenizar com `split_whitespace` e casar o caminho normalizado contra o conjunto de arquivos de código;
  - HTML: varrer `<script` até `>`, extrair `src` com aspas simples ou duplas, ignorar o que contém `://` ou começa com `//`, e juntar com o diretório do HTML;
  - BFS em dois passes, um a partir das entradas de produção e outro a partir das entradas de teste;
  - uso de exports conforme a spec, seção 4.3, com memoização por (arquivo, nome) e conjunto de visitados.
- [ ] **Step 4:** rodar `cargo test --workspace`, com um snapshot `export-sample-project` atualizado (o `deadCode` aparece). Depois `pnpm build:wasm`, e um teste do `core-wasm` (`deadCode()` em camelCase, `undefined` antes de `finish`). Também os testes web de `handler`, `store` (com `deadCode` no estado depois de abrir o projeto) e o typecheck.
- [ ] **Step 5:** commit `feat(core): entry-point heuristics, reachability and unused exports`.

### Task 3: heatmap na web

**Files:**
- Create: `apps/web/src/renderer/heat.ts`, `src/components/HeatLegend.tsx`, `src/components/ColorBySelect.tsx`
- Modify:
  - `store/graph-store.ts` (`colorBy`, `setColorBy`) e `store/url.ts` (`color=`);
  - `renderer/theme.ts` (as cores `heat[5]`, `unused` e `testOnly`), `renderer/sync.ts`, `renderer/GraphCanvas.tsx`;
  - `components/Toolbar.tsx`, `components/Explorer.tsx`, `App.tsx` (a legenda dentro do `main`);
  - `export/svg.ts` (`buildSvg(scene, theme, legend?)`);
  - `components/ExportMenu.tsx` (passa a legenda);
  - `styles/tokens.css`, `styles/app.css`, e os catálogos `en`/`pt-BR` (grupo `heat`).
- Test: `test/renderer/heat.test.ts`, `test/store/url.test.ts`, `test/renderer/sync.test.ts`, `test/components/HeatLegend.test.tsx`, `test/components/Explorer.test.tsx`, `test/export/svg.test.ts`

**Interfaces:**
- `type ColorBy = 'none' | 'fanIn' | 'fanOut' | 'loc' | 'unused'`
- `metricOf(n: VNode, c: Exclude<ColorBy, 'none' | 'unused'>): number`
- `heatScale(values: number[]): HeatScale`, com `HeatScale = { bands: { min: number; max: number }[]; band(v: number): number }`. O `band` devolve o índice de 0 a `bands.length - 1`.
- `syncGraph(g, r, cache, theme, paint?: (n: VNode) => Partial<{ color: string; borderColor: string }>)`
- `Legend = { title: string; items: { color: string; label: string }[] }`
- `buildSvg(scene, theme, legend?: Legend)`

- [ ] **Step 0:** carregar a skill `dataviz` e escolher a rampa sequencial de 5 passos (um matiz) e as duas cores âmbar, validando o contraste contra `--color-paper`. Registrar a escolha no ledger.
- [ ] **Step 1: testes**
  - `heatScale([1,2,3,4,5,6,7,8,9,10])` tem 5 faixas, com `band(1) == 0` e `band(10) == 4`;
  - `heatScale([4,4,4])` tem 1 faixa;
  - `heatScale([0,0,5])`: `band(0) == 0`;
  - `heatScale([])` tem 0 faixas;
  - a URL faz o caminho de ida e volta com `color=loc` e cai em `none` com `color=xyz`;
  - `syncGraph` com `paint` que devolve vermelho para o nó 2 grava `color` vermelho no graphology;
  - `HeatLegend` com `colorBy='loc'` mostra o título "Lines" e um intervalo `1–3`, e não renderiza nada com `none`;
  - o explorador com `colorBy='fanIn'` mostra o valor numa linha;
  - `buildSvg` com legenda contém o título da legenda e um `rect` por item;
  - o `ColorBySelect` troca o store.
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** implementar. O `GraphCanvas` calcula a escala sobre `renderable(...)` e passa o `paint`. A legenda usa os rótulos da escala, formatados com `t.fmt.int`. No modo `unused`, a legenda tem duas amostras: "Unused" e "Used only by tests".
- [ ] **Step 4:** `vitest run`, `typecheck` e `lint` passam.
- [ ] **Step 5:** commit `feat(web): color the graph by fan-in, fan-out, lines or usage`.

### Task 4: código morto na interface

**Files:**
- Create: `apps/web/src/components/DeadCodePanel.tsx`
- Modify: `components/StatusBar.tsx` (novo item e disclosure), `components/DetailPanel.tsx` (selo e seção), `components/Explorer.tsx` (marcador), catálogos (grupo `dead`), `styles/app.css`
- Test: `test/components/StatusBar.test.tsx`, `test/components/DetailPanel.test.tsx`, `test/components/DeadCodePanel.test.tsx`

**Interfaces:**
- `statusItems` passa a receber `unused: number` e devolve 8 itens: arquivos, arestas, ciclos, externos, não resolvidos, ignorados, **sem uso** e tempo. O índice do novo disclosure é 6.

- [ ] **Step 1: testes**
  - `statusItems(...)` em inglês inclui `2 unused`;
  - clicar em `2 unused` abre a região "Unused code", com as tabelas "Unused files" (2 linhas), "Used only by tests" e "Unused exports";
  - clicar num caminho chama `reveal`;
  - com `fallback`, o painel mostra a nota de fallback;
  - o detalhe de um arquivo com `usage: 'unused'` mostra o selo "Unused" e a seção "Unused exports" com os nomes;
  - o detalhe com `usage: 'entry', entryReason: 'packageJson'` mostra "Entry · package.json";
  - o explorador marca um arquivo `unused` com o texto acessível "unused";
  - ao trocar para pt-BR, aparece "Código sem uso".
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `vitest run`, `typecheck` e `lint` passam.
- [ ] **Step 5:** commit `feat(web): unused code panel, usage badge and explorer marker`.

### Task 5: e2e e documentação

- [ ] **Step 1:** no e2e, escolher "Color by" → "Lines", conferir que a legenda "Lines" aparece e voltar para "None". Depois clicar no item `unused` da barra e conferir que a região "Unused code" mostra a nota de fallback (o `sample-project` não tem entradas de produção).
- [ ] **Step 2:** `pnpm --filter @archviewer/web e2e` passa.
- [ ] **Step 3:** atualizar os READMEs (recursos "Heatmap" e "Unused code", e tirar os dois itens do roadmap) e o `CONTRIBUTING` (a fixture `dead-code`).
- [ ] **Step 4:** commit `test(web): e2e for heatmap and unused code; docs`.
