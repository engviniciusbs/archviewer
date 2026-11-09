# ArchViewer — Comparar versões

- **Data:** 2026-11-09
- **Status:** aprovado em conversa; o usuário autorizou plano, implementação e merge
- **Subprojeto:** C3 do roadmap (#8)

## 1. Objetivo

Mostrar o que mudou na arquitetura entre duas versões do mesmo projeto: arquivos, pacotes externos, dependências, ciclos, acoplamento e código sem uso.

**Fora de escopo:**
- detectar renomeações (um arquivo renomeado aparece como removido mais adicionado);
- ler o histórico do git;
- mostrar os dois grafos lado a lado.

## 2. Fontes da versão "antes"

O botão **Compare** na barra superior abre um menu (o mesmo padrão de menu button do Export) com estes itens:

- **With an exported JSON…**: um `<input type="file" accept="application/json,.json">`.
  - O conteúdo é validado: precisa ser um objeto com `version === 1`, `schema` igual ao do export, e `files`, `edges`, `externals`, `cycles` e `summary` com as formas certas.
  - Qualquer falha gera a mensagem "This file is not an ArchViewer graph export".
  - Se o `project` for diferente do projeto atual, aparece um aviso, mas a comparação segue.
- **With another folder…**: o mesmo `pickDirectory` e o mesmo fluxo de ingestão (`scan`, `filterIngestible`, `readInto`), num **cliente de análise novo** (`deps.api()`).
  - A sequência é `start`, `addFiles`, `finish` e `exportGraph`, seguida de `dispose`.
  - O progresso aparece no painel.
  - Não há a confirmação de projeto grande.
- **Stop comparing**, que só aparece com uma comparação ativa.

Uma **pílula** na barra superior mostra a comparação ativa, por exemplo `Comparing with <rótulo>`, e tem um botão para fechar. O rótulo é o nome do arquivo JSON ou o nome da pasta. Abrir outro projeto limpa a comparação.

## 3. `diffGraphs(before, after): GraphDiff`

É uma função pura em `apps/web/src/compare/diff.ts`. O "after" é o `exportGraph()` do projeto aberto.

```ts
type EdgeRef = { from: string; to: string; external: boolean };
type GraphDiff = {
  filesAdded: string[];
  filesRemoved: string[];
  externalsAdded: string[];
  externalsRemoved: string[];
  edgesAdded: EdgeRef[];
  edgesRemoved: EdgeRef[];
  cyclesAdded: string[][];
  cyclesResolved: string[][];
  fanInChanges: { path: string; before: number; after: number }[];
  newlyUnused: string[];
  summary: { files: number; edges: number; cycles: number; externals: number; unused: number };
  changeCount: number;
};
```

- **Arestas:** a identidade é o par `from → to`; o tipo do import não importa. Uma aresta repetida com outro tipo conta uma vez só.
- **Ciclos:** a identidade é o conjunto de caminhos, ordenado e unido com `\n`.
- **Fan-in:** são os importadores distintos por arquivo, contados a partir das arestas entre arquivos (`external === false`). Só entram arquivos que existem nas duas versões e com delta diferente de 0. A lista é ordenada por `|delta|` decrescente e, depois, por caminho; ficam os 10 primeiros.
- **`newlyUnused`:** arquivos que estão em `after.deadCode.unusedFiles` e não estão em `before.deadCode.unusedFiles`. Um export antigo, sem `deadCode`, é tratado como lista vazia.
- **`summary`:** guarda os deltas (after − before). O de `unused` usa o tamanho de `deadCode.unusedFiles`.
- **`changeCount`** é a soma dos tamanhos de `filesAdded`, `filesRemoved`, `externalsAdded`, `externalsRemoved`, `edgesAdded`, `edgesRemoved`, `cyclesAdded` e `cyclesResolved`.
- Todas as listas saem ordenadas por caminho; as de arestas, por (`from`, `to`).

## 4. Exibição

- **Barra de status:** um item `N changes` (`N mudanças`) aparece só com comparação ativa e abre o `ComparePanel`. As seções são:
  - Arquivos novos / removidos;
  - Pacotes novos / removidos;
  - Dependências novas / removidas, agrupadas por par de pastas (`dirname(from) → dirname(to)`, com o próprio nome para externos);
  - Ciclos novos / resolvidos;
  - Maiores variações de fan-in;
  - Passaram a ficar sem uso.

  Cada lista mostra até 200 itens, mais "and N more". Os caminhos que existem no projeto atual são botões que revelam o nó. Sem mudanças, aparece "No changes between the two versions.".
- **`colorBy: 'changes'`:** a opção "Changes" só fica no seletor com comparação ativa. Se a comparação acaba enquanto ela está selecionada, o modo volta para `none`. A cor de cada nó segue estas regras:
  - arquivo em `filesAdded`: `--color-added` (aqua, `#1baf7a`);
  - arquivo existente que aparece em alguma aresta adicionada ou removida (como `from` ou `to`): `--color-changed` (violeta, `#6250d6`);
  - grupo recolhido com algum arquivo adicionado ou alterado abaixo dele (por prefixo de caminho): borda `--color-changed`;
  - externo em `externalsAdded`: `--color-added`.

  A legenda tem duas amostras: "Added" e "Changed dependencies". O par foi validado com o `dataviz`: CVD ΔE 27,1 e visão normal 32,8. O aqua fica abaixo de 3:1 de contraste contra o fundo, o que é compensado pela legenda com texto e pelo painel com a lista.
- O PNG e o SVG herdam as cores e a legenda do modo.

## 5. Erros

| Caso | Comportamento |
|---|---|
| JSON inválido ou de outra ferramenta | Mensagem no feedback do menu; nenhuma comparação começa |
| A pasta de base falha (worker, leitura) | Mensagem com o detalhe; a comparação anterior, se houver, continua |
| O usuário cancela o seletor | Nada acontece |

## 6. Testes

- **`diffGraphs`:**
  - entradas idênticas resultam em `changeCount` 0;
  - arquivos, externos, arestas, ciclos, fan-in e `newlyUnused`;
  - a ordem dos arrays de entrada não altera a saída;
  - um export sem `deadCode`.
- **`parseExport`:** um JSON válido; JSON quebrado; `version` 2; `schema` diferente; campos faltando.
- **Store:**
  - `compareWithExport(text, label)`;
  - `compareWithFolder(source)` com cliente falso: confere que o `dispose` foi chamado e que o progresso foi publicado;
  - `clearComparison`;
  - abrir projeto limpa a comparação;
  - um `colorBy` `changes` volta a `none`.
- **Componentes:**
  - o painel (seções, "and N more", navegação, sem mudanças);
  - a pílula;
  - o item da barra;
  - o menu Compare;
  - o painter do modo `changes`;
  - a legenda;
  - em pt-BR.
- **e2e:**
  - exportar o JSON, comparar com ele e ver `0 changes`;
  - comparar com o JSON sem `src/utils/helpers.ts` e ver o arquivo listado em "Added files" (ele existe no atual e não na base).
