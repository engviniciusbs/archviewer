# ArchViewer — Replanejamento (design)

- **Data:** 2026-11-08
- **Status:** aprovado em conversa, aguardando revisão da spec escrita
- **Substitui:** o scaffold do commit `284edb4`

## 1. Contexto e objetivo

ArchViewer é uma ferramenta open source, 100% no navegador, que abre a pasta de um projeto JS/TS local e mostra a arquitetura dele como um grafo interativo.

**Objetivos (decididos):**

- **Portfólio/aprendizado:** a tecnologia faz parte do valor (Rust → WASM, WebGL).
- **Uso diário próprio:** precisa funcionar em codebases reais.
- **Open source:** deve aguentar projetos de qualquer tamanho, inclusive monorepos de 20 mil+ arquivos.

**Perguntas que a ferramenta precisa responder:**

1. "Como o projeto está organizado?": visão por pastas e pacotes, não arquivo a arquivo.
2. "O que este arquivo/módulo faz?": explicações com IA (fase v2).

**Fora de escopo no v1:** IA, CLI nativa, linguagens além de JS/TS, modo escuro, análise de impacto ("o que quebra se eu mexer aqui") como recurso dedicado.

### Problemas do scaffold atual que motivam o replanejamento

- Os tipos de saída do Rust (snake_case) não batem com os tipos do TS (camelCase); `SideEffect` serializa como `"sideeffect"`.
- Imports não resolvidos geram arestas para nós inexistentes, e o `forceLink` do D3 lança erro.
- `apps/web` não declara `@archviewer/wasm-parser` nem `@archviewer/ai-bridge` como dependências.
- O parser ignora `import()` dinâmico e re-exports (`export * from`), e só detecta `require` no topo do arquivo.
- Só o primeiro `tsconfig` é lido, o `extends` é ignorado e os aliases são resolvidos a partir da raiz.
- Selecionar um nó reinicia o layout inteiro; a busca não está ligada ao grafo.
- O SVG não escala além de ~2 mil nós; a detecção de ciclos é O(n²).
- Não há testes nem configuração de lint.

## 2. Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Núcleo | Crate Rust próprio que faz parse, resolução, análise e hierarquia | O Rust só compensa se fizer o trabalho pesado; também fortalece o portfólio e abre caminho para uma CLI |
| Parser | `oxc_parser` | É o parser JS/TS mais rápido; recupera de erros |
| Resolução | `oxc_resolver` com sistema de arquivos em memória | Lida com tsconfig (`paths`, `extends`), `exports` do package.json e workspaces |
| Frontend | React + Vite, SPA estática (não Next.js) | Tudo roda no cliente; deploy estático e gratuito; reforça a promessa de privacidade |
| Renderização | Sigma.js + graphology (WebGL), layout ForceAtlas2 em worker | Escala para dezenas de milhares de nós |
| Estado | Zustand | Store simples, fora da árvore do React |
| IA (v2) | Chave própria (BYOK) direto do navegador; um proxy hospedado é possível depois | Sem servidor agora; a interface `LLMProvider` já comporta um proxy |
| Visual | Skill Hallmark, tema **Cobalt** | Pedido do usuário; é o tema do Hallmark para ferramentas de desenvolvedor |
| Navegadores | Chrome/Edge completos; Firefox/Safari via `webkitdirectory` com aviso | File System Access API |

## 3. Arquitetura

```
archviewer/
├── crates/
│   └── archviewer-core/      # Rust puro: parse, resolução, análise, hierarquia
├── packages/
│   ├── core-wasm/            # wrapper wasm-bindgen + tipos TS gerados (tsify)
│   └── ai-bridge/            # provedores LLM (v2)
├── apps/web/                 # React + Vite + Sigma.js
└── fixtures/                 # projetos de teste com expected.json
```

- **`archviewer-core`** não depende de nada de WASM. É testado com `cargo test` e pode virar uma CLI no futuro.
- **`core-wasm`** é uma camada fina. Ela expõe o `Analyzer` via `wasm-bindgen` e gera os tipos TS com `tsify`, para que o Rust e o TS nunca divirjam. Usa `serde(rename_all = "camelCase")` e `console_error_panic_hook`.
- **`packages/wasm-parser`** é substituído pelos dois pacotes acima.

### Unidades do app web

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `ingest/` | Percorre a pasta, respeita o `.gitignore` e as pastas ignoradas por padrão, lê em lotes, reporta progresso e permite cancelar | File System Access API / `webkitdirectory` |
| `analysis.worker` | Carrega o WASM, mantém a sessão do `Analyzer` e responde a `view` e `detail` | `core-wasm` |
| `graph-store` | Guarda o resumo, o `VisibleGraph` atual, os grupos expandidos, a seleção e os filtros | — |
| `renderer/` | Desenha o `VisibleGraph` com Sigma, roda o layout num worker e mantém cache de posições por id | `graph-store` |
| `components/` | Toolbar, explorador, painel de detalhes, barra de status | `graph-store` |

O renderer só lê o store. Mudar a seleção nunca reinicia o layout.

## 4. Contrato de dados

O worker mantém uma sessão de `Analyzer` viva dentro do WASM. O grafo completo nunca é serializado para a UI.

```
UI ──pasta──▶ ingest ──lotes──▶ worker / Analyzer (WASM)
                                   │ add_files(batch)  → progresso
                                   │ finish()          → AnalysisSummary
UI ◀── VisibleGraph ◀── view(expandedGroupIds)
UI ◀── FileDetail   ◀── detail(nodeId)
```

### API do `Analyzer`

| Método | Entrada | Saída |
|---|---|---|
| `new(config)` | opções (ex.: tamanho máximo de arquivo) | sessão |
| `add_files(batch)` | `[{ path, content }]`, incluindo `tsconfig.json`, `jsconfig.json`, `package.json` e `pnpm-workspace.yaml` | `{ parsed, failed }` |
| `finish()` | — | `AnalysisSummary`: contagens de arquivos, arestas, ciclos, não resolvidos e ignorados; avisos; tempo |
| `view(expandedGroupIds)` | ids dos grupos expandidos | `VisibleGraph` |
| `detail(nodeId)` | id de arquivo ou grupo | `FileDetail` ou `GroupDetail` |

### Modelo interno

- **Ids numéricos (`u32`)** para nós; os caminhos ficam numa tabela de strings à parte.
- **Arquivo:** caminho, linguagem, linhas de código, exports, erros de parse (com linha e coluna), fan-in, fan-out.
- **Tipos de aresta:** `static`, `dynamic`, `reexport`, `require`, `typeOnly`, cada uma com seus specifiers.
- **Pacotes externos:** um nó por nome de pacote (`react`, `@scope/pkg`), sem o subcaminho.
- **Não resolvidos:** lista separada de `{ from, specifier, reason }`. Nunca viram arestas. Os motivos são `notFound`, `asset` (`.css`, `.svg`, imagens…) e `unknownAlias`.
- **Grupos:** a árvore de pastas. Em monorepos, os pacotes do workspace são grupos de topo, com o nome do pacote.
- **Ciclos:** componentes fortemente conexos, calculados com Tarjan em O(n + e). Cada aresta dentro de um componente com mais de um nó é marcada `inCycle`.

### `VisibleGraph`

- **Nós:** `{ id, kind: group | file | external, label, size, parentId, inCycle, expandable, expanded }`. Grupos expandidos vêm com `expanded: true`, para o explorador de arquivos; o renderer só desenha os não expandidos.
- **Arestas:** `{ from, to, weight, inCycle, typeOnly }`, agregadas até o ancestral visível mais próximo de cada lado. As arestas internas a um grupo recolhido são omitidas.
- **Estado inicial:** só o nível de topo (pastas de primeiro nível, ou os pacotes do workspace).

## 5. Interface

O layout tem cinco áreas: toolbar, explorador à esquerda, grafo ao centro, detalhes à direita e barra de status.

- **Grafo:**
  - Duplo clique expande ou recolhe um grupo. Os filhos nascem ao redor da posição do pai, e o layout só reajusta localmente.
  - As posições ficam em cache por id, então recolher e expandir de novo devolve o mesmo desenho.
  - Clique simples seleciona e destaca os vizinhos diretos; o resto fica esmaecido.
  - Os rótulos aparecem conforme o zoom.
- **Explorador:** a mesma hierarquia do grafo, sincronizada nos dois sentidos.
- **Busca:** filtra a árvore. Escolher um resultado expande o caminho até ele, centraliza e seleciona.
- **Filtros:** ocultar externos, ocultar imports só de tipo, ocultar assets, mostrar só ciclos.
- **Painel de detalhes:**
  - Para um arquivo: caminho, linhas, exports, imports e dependentes (clicáveis), ciclos e fan-in/fan-out.
  - Para um grupo: totais e as maiores dependências de entrada e de saída.
- **Barra de status:** progresso da leitura. Depois, o resumo: arquivos, arestas, ciclos, não resolvidos (clicável, abre a lista com os motivos), ignorados e tempo.

### Visual: Hallmark, tema Cobalt

- **Fluxo:** a implementação da UI segue a skill Hallmark (`~/.agents/skills/hallmark`) no modo **App screens** (`references/flow.md` § App screens).
- **Tokens:** `tokens.css` e `base.css` são regenerados com `theme.mjs scaffold cobalt`. Stamp: `theme: cobalt (by request)`.
- **Por que Cobalt:**
  - é o tema do gênero modern-minimal voltado para ferramentas de desenvolvedor
  - permite JetBrains Mono para valores técnicos
  - usa linhas finas, o que serve a uma tela densa
  - tem painéis grafite para código
- **Tradução do tema para o app:**
  - **Fundo do grafo:** `--color-paper`. Nós e arestas em `--color-ink`/`--color-muted`. Grupos como painéis com cantos cortados (`.cut`), linha `--color-rule` e fundo `--color-paper-2`.
  - **Seleção:** cobalto (`--color-accent`), com destaque em `--color-accent-wash`. O cobalto fica abaixo de 5% da tela.
  - **Ciclos:** `--color-error`, tracejados. Se o scaffold do Cobalt não emitir esse token, ele é declarado no bloco de tokens seguindo o padrão do Hallmark para modern-minimal: `oklch(52% 0.19 27)`.
  - **Fontes:**
    - Familjen Grotesk em títulos, rótulos e cabeçalhos de painel (nunca mono nesses lugares)
    - IBM Plex Sans no corpo
    - JetBrains Mono em caminhos, specifiers e valores técnicos
  - **Painel de detalhes:**
    - nome do item
    - fan-in/fan-out como números grandes em Familjen 600, com algarismos tabulares (a assinatura visual)
    - um painel grafite (`.graphite`) com o trecho do arquivo e os imports destacados em `--color-accent-2`
  - **Toolbar:** botões keycap (`.key`); "Abrir projeto" é a única tecla primária, em cobalto. Os filtros são teclas numa bandeja `--color-paper-3`, com a ativa afundada.
  - **Campo ASCII:**
    - **Onde:** só na tela de leitura e análise, nunca atrás do grafo.
    - **O que mostra:** dados reais do processo. Arquivos chegando "crus" de um lado e resolvidos do outro, com densidade proporcional ao progresso real.
    - **Como roda:** canvas a 30 fps, pausado fora da tela.
    - **Fallbacks:** imagem parada sob `prefers-reduced-motion`; grade de pontos sem JavaScript.
  - **Status:** texto com um ícone, nunca um chip preenchido.
  - **Movimento:** teclas em `--dur-micro`. Fora isso, só o layout do grafo se move.
- **Regras obrigatórias do Hallmark que se aplicam aqui:**
  - toda cor e toda fonte vêm de tokens
  - `:focus-visible` em todo controle
  - fallback para `prefers-reduced-motion`
  - sem `transition: all`
  - rótulos em sentence case, sem caixa alta espaçada
- **WebGL e tokens:** o Sigma não lê variáveis CSS. O renderer lê os tokens via `getComputedStyle(document.documentElement)` ao iniciar e passa as cores para o Sigma. Nenhuma cor literal no código do renderer.
- **Modo:** só claro no v1.

## 6. Tratamento de erros

Princípio: um arquivo problemático nunca derruba a análise.

| Situação | Comportamento |
|---|---|
| Erro de sintaxe | O OXC recupera o que der; o arquivo entra no grafo com o erro (linha e coluna) visível no painel |
| Import não resolvido | Vai para a lista de não resolvidos com o motivo; assets formam uma categoria que dá para ocultar |
| `tsconfig` inválido ou `extends` quebrado | Aviso no resumo; a resolução segue sem os aliases daquele tsconfig |
| Arquivo ilegível ou > 2 MB | É ignorado e listado com o motivo |
| Projeto grande | Antes de ler, mostra a contagem estimada e pede confirmação acima de 10 mil arquivos; a leitura pode ser cancelada a qualquer momento |
| Falha ao carregar o WASM ou worker encerrado | Tela de erro com opção de recarregar; o estado da UI não é corrompido |
| Pânico no Rust | `console_error_panic_hook` transforma em mensagem legível, que volta como erro do worker |
| Sem File System Access API | Usa `webkitdirectory` e mostra um aviso discreto |

## 7. Testes

1. **`archviewer-core` (`cargo test`):**
   - Snapshots com `insta`, um `expected.json` por fixture: `sample-project`, `tsconfig-paths`, `monorepo-pnpm`, `commonjs`, `broken`.
   - Testes unitários: resolução, Tarjan, agregação de `view()`, casos de erro.
   - Teste de desempenho com um projeto sintético de 20 mil arquivos e um tempo máximo aceito.
2. **`core-wasm` (Vitest no Node):** carrega o WASM compilado, roda o `sample-project` e valida a saída contra os tipos gerados.
3. **`apps/web` (Vitest + Testing Library):** `ingest` (`.gitignore`, lotes, cancelamento) e `graph-store` (expandir, recolher, selecionar, filtrar).
4. **Ponta a ponta (Playwright):** abrir o `sample-project` injetado, ver os grupos, expandir, selecionar e conferir o painel. Na mesma etapa roda o `sloplint --scope app` do Hallmark contra o dev server.
5. **CI (GitHub Actions):** `cargo test`, Vitest, typecheck, lint e Playwright em cada PR.

## 8. Fases

1. **v1, núcleo e visão por pastas:** todas as seções acima, exceto a IA.
2. **v2, IA:**
   - "Explicar com IA" para arquivo ou grupo, via `ai-bridge` (BYOK; modelos padrão atualizados).
   - Chave guardada localmente, com aviso.
   - Prévia exata do conteúdo antes de cada envio.
   - O contexto vem de `detail()`.
3. **Depois:** proxy de IA hospedado (serviço separado), CLI nativa sobre `archviewer-core`, modo escuro, outras linguagens.

## 9. O que se aproveita do scaffold

- A estrutura de monorepo (pnpm + Turborepo) e o `fixtures/sample-project`.
- A interface `LLMProvider` e os prompts de `ai-bridge` (revisados no v2).
- A lógica de `useFileSystem` como ponto de partida do `ingest/`.

O parser Rust, o `GraphView` em D3 e o tema Terminal são substituídos.

## 10. Riscos

- **Toolchain WASM:** o ecossistema `rustwasm` trocou de mantenedores em 2025. Confirmar o estado do `wasm-pack` antes de fixar o toolchain; a alternativa é `wasm-bindgen-cli` direto.
- **`oxc_resolver` em WASM:** depende de implementar o trait de sistema de arquivos em memória. Validar isso cedo, como primeira tarefa do plano.
- **Memória em repos enormes:** todo o conteúdo dos arquivos passa pelo WASM. Mitigação: descartar o texto-fonte depois do parse e manter só o modelo.
