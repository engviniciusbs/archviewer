# ArchViewer — Métricas, heatmap e código morto

- **Data:** 2026-11-09
- **Status:** aprovado em conversa; o usuário autorizou ir direto para plano, implementação e merge
- **Subprojetos:** C1 (métricas e heatmap) e C2 (código morto), ambos do roadmap (#8)

## 1. Objetivo

Responder duas perguntas que hoje exigem clicar nó por nó:

1. **Onde estão os pontos quentes?** Arquivos e pastas com muito acoplamento (fan-in e fan-out) ou muito código.
2. **O que ninguém usa?** Arquivos inalcançáveis, arquivos que só os testes usam e exports que ninguém importa.

**Fora de escopo:**
- marcar entradas manualmente;
- detectar uso de exports dentro do próprio arquivo;
- seguir caminhos de import computados (`import(variavel)`);
- convenções de frameworks além do Next.js.

## 2. Métricas (C1)

Cada `VNode` ganha `metrics: NodeMetrics { fan_in, fan_out, loc, unused }`, calculado em `view()`:

| Nó | `fanIn` | `fanOut` | `loc` | `unused` |
|---|---|---|---|---|
| Arquivo | importadores distintos (igual ao do detalhe) | arquivos e externos importados, distintos | linhas | 1 se `unused`, senão 0 |
| Grupo recolhido | arquivos distintos **de fora** que importam algo de dentro | nós distintos de fora importados por algo de dentro | soma das linhas abaixo | arquivos `unused` abaixo |
| Externo | importadores distintos | 0 | 0 | 0 |

"De fora" é relativo ao representante na visão: uma aresta entre dois arquivos que estão dentro do mesmo grupo recolhido não conta.

## 3. Heatmap (C1)

- **Estado:** `colorBy: 'none' | 'fanIn' | 'fanOut' | 'loc' | 'unused'`, com padrão `none`. Ele fica no store e vai para a URL como `?color=…`, junto com os filtros. Um valor desconhecido na URL vira `none`.
- **Seletor "Colorir por"** num `<select>` ao lado dos filtros.
- **Escala sequencial** de 5 faixas por quantis dos valores dos nós **desenhados** (o `renderable` atual):
  - os limites são os quantis 0,2, 0,4, 0,6 e 0,8;
  - faixas repetidas (por exemplo, quando todos os valores são iguais) se fundem;
  - o valor 0 sempre cai na faixa mais clara;
  - as cores vêm dos tokens `--color-heat-1` a `--color-heat-5`, um único matiz do claro ao escuro.
- **Modo `unused`** é categórico:
  - arquivo `unused`: `--color-unused` (âmbar);
  - arquivo `testOnly`: `--color-test-only` (âmbar claro);
  - grupo com `unused > 0`: borda âmbar;
  - o resto fica neutro.
- **Prioridades:** a seleção e o esmaecimento dos não vizinhos continuam vindo dos reducers, e as arestas de ciclo seguem vermelhas.
- **Legenda** sobreposta no canto inferior esquerdo do canvas, com título, amostras de cor e intervalos (`0`, `1–3`, `4–9`…). Ela some no modo `none`.
- **Exportação de imagem:** o PNG e o SVG herdam as cores. Com heatmap ativo, o `buildSvg` desenha a mesma legenda no canto inferior esquerdo.
- **Explorador:** com heatmap ativo, cada linha mostra à direita o valor da métrica (no modo `unused`, um marcador).

## 4. Código morto (C2)

### 4.1 Entradas

`EntryReason` tem os seguintes valores:

| Motivo | Regra |
|---|---|
| `packageJson` | `main`, `module`, `browser`, `types`, todas as folhas string de `exports` e `bin` (string ou objeto), de cada `package.json`. Cada valor é resolvido como import a partir do diretório do pacote. |
| `script` | Nos `scripts` do `package.json`, todo token que, depois de normalizado em relação ao diretório do pacote, é um arquivo de código do projeto. |
| `html` | `src` de cada `<script ...>` dos arquivos `index.html`. Um `/x` é relativo ao diretório do HTML. |
| `framework` | `pages/**` (qualquer arquivo de código) e `app/**/{page,layout,route,loading,error,not-found,template,default}.<ext>`, em qualquer nível. |
| `config` | Nome que casa com `*.config.*` ou com `.*rc.*`. |
| `test` | `*.test.*`, `*.spec.*`, ou caminho com um segmento `__tests__`, `test`, `tests` ou `e2e`. |
| `story` | `*.stories.*` |
| `declaration` | `*.d.ts`, `*.d.mts`, `*.d.cts` |

As regras de `framework` para baixo usam só o caminho. Um arquivo pode casar com mais de uma regra; vale a primeira da tabela.

**Ingestão:** arquivos `index.html` passam a ser ingeridos como configuração, assim como `package.json` e `tsconfig`.

### 4.2 Alcance

- **Entradas de produção:** `packageJson`, `script`, `html`, `framework` e `config`. **Entradas de teste:** `test` e `story`. **Declarações** (`declaration`) não alcançam nada.
- A busca segue todas as arestas entre arquivos (todos os `ImportKind`).
- **Estados (`FileUsage`):**
  - `entry`: o arquivo é uma entrada;
  - `used`: é alcançado a partir de alguma entrada de produção;
  - `testOnly`: só é alcançado a partir de entradas de teste;
  - `unused`: nenhuma entrada o alcança.
- **Fallback:** sem nenhuma entrada `packageJson`, `script`, `html` ou `framework`, o campo `fallback` vale `true`. Nesse modo, `unused` passa a significar "não é entrada e não tem importadores", e `testOnly` fica vazio.

### 4.3 Exports sem uso

A análise vale para arquivos `used` e `testOnly`; entradas ficam de fora porque os exports delas são API pública. Um nome `n` exportado por F (ignorando o `"*"` da própria lista de exports) conta como **usado** em qualquer um destes casos:

1. alguma aresta que chega a F tem `n` ou `"*"` nos `specifiers`;
2. alguma aresta que chega a F é `dynamic` ou `require` e não tem `specifiers`;
3. algum R tem uma aresta `reexport` com `specifiers == ["*"]` para F, e `n` é usado a partir de R (recursivo, com conjunto de visitados contra ciclos). Se R for uma entrada, todo `n` conta como usado.

O resultado vem ordenado por caminho, e os nomes ficam na ordem em que foram declarados.

### 4.4 API

- **Tipos:**
  - `DeadCode { entries: Vec<EntryPoint { path, reason }>, unused_files: Vec<String>, test_only_files: Vec<String>, unused_exports: Vec<UnusedExports { path, names }>, fallback: bool }`, com tudo ordenado por caminho.
- **Métodos e campos:**
  - `Analyzer::dead_code() -> Option<DeadCode>`, que no WASM vira `deadCode()`;
  - `FileDetail` ganha `usage: FileUsage`, `entry_reason: Option<EntryReason>` e `unused_exports: Vec<String>`;
  - `GraphExport` ganha `dead_code: DeadCode`, mantendo `version` em 1.
- **Cálculo:** tudo é feito uma vez no `finish`, que já tem o resolver e o conteúdo dos `package.json` e dos `index.html`.

## 5. Interface do código morto (C2)

- **Barra de status:** um item `N sem uso` (`N unused`) que conta `unusedFiles`. Ele abre um painel no mesmo padrão de "não resolvidos", com três tabelas: "Arquivos sem uso", "Só usados por testes" e "Exports sem uso" (caminho e nomes). Cada caminho é um botão que revela o nó. O rodapé explica as heurísticas, avisa quando o fallback está ativo e traz um link para abrir uma issue: `https://github.com/engviniciusbs/archviewer/issues/new?template=bug_report.yml`.
- **Painel de detalhes de arquivo:**
  - um selo com o estado: "Unused", "Used only by tests" ou `Entry · <reason>`;
  - uma seção "Unused exports", quando houver.
- **Explorador:** arquivos `unused` ganham um marcador âmbar, com o texto acessível "unused".
- Todos os textos vão para `en` e `pt-BR`.

## 6. Testes

- **Fixture `dead-code`**, que cobre:
  - entradas por `package.json`, tanto `main` quanto `exports` aninhado, e por `bin`, `index.html`, `scripts`, config, teste, story e Next.js `app/page.tsx`;
  - uma cadeia morta A → B;
  - um arquivo `testOnly`;
  - um barrel com `export *` e outro com re-export nomeado;
  - `import * as`, `default` e import dinâmico.
- **Fallback:** um teste com o `sample-project`, que não tem entradas de produção.
- **`view()`:** `metrics` em arquivo, grupo recolhido (sem contar arestas internas) e externo.
- **Web:**
  - quantis (todos iguais, zeros, poucos valores);
  - `colorBy` na URL;
  - a cor aplicada pelo `syncGraph`;
  - a legenda;
  - a legenda no SVG;
  - os valores no explorador;
  - o painel de código morto;
  - o selo e a seção no detalhe;
  - nos dois idiomas.
- **e2e:** escolher "Colorir por: Linhas" mostra a legenda; o item "sem uso" abre o painel com a nota de fallback.
