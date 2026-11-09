# ArchViewer — Exportar e compartilhar

- **Data:** 2026-11-09
- **Status:** aprovado em conversa; o usuário autorizou seguir direto para plano, implementação e merge
- **Subprojeto:** B do roadmap (issue #8)

## 1. Objetivo

Quem analisa um projeto precisa levar o resultado para fora do app: uma imagem para um PR ou para documentação, um diagrama Mermaid para colar no Markdown, os dados completos para scripts, e um badge para o README.

**Critérios de sucesso:**

1. Um menu "Exportar" na barra superior oferece PNG, SVG, Mermaid, JSON completo e badge.
2. PNG, SVG e Mermaid representam a **visão atual**: grupos expandidos, filtros e destaque da seleção. O JSON representa o **projeto inteiro** em nível de arquivo.
3. Tudo é gerado no navegador. Só o badge carrega uma URL do `shields.io`, e ela contém apenas contagens.
4. Os textos do menu estão nos dois idiomas, e a interface é acessível por teclado e por leitor de tela.

**Fora de escopo:** publicar um JSON Schema, gerar um badge que se atualiza sozinho, exportar em PDF, e exportar só a área visível no zoom atual.

## 2. Interface

- **Botão "Exportar"** na barra superior, antes do seletor de idioma. Ele abre um menu no padrão WAI-ARIA *menu button*: `aria-haspopup="menu"`, setas e Home/End para navegar, Esc fecha e devolve o foco ao botão.
- **Itens:**
  - Imagem PNG (download)
  - Imagem SVG (download)
  - Diagrama Mermaid (cópia)
  - Grafo completo em JSON (download)
  - Badge para README (cópia)
- **Feedback** numa região `aria-live="polite"`: "Copiado", "Baixado <arquivo>", ou o erro traduzido seguido do detalhe técnico.
- **Fallback de cópia:** se a área de transferência não estiver disponível ou recusar, abre um `<dialog>` com o texto num `<textarea>` já selecionado, mais um botão para fechar.
- **Nomes de arquivo:** `<projeto>-archviewer.{png,svg,json}`. O nome do projeto passa por slug (minúsculas, `[a-z0-9-]`, sem hífens nas pontas) e cai em `project` quando fica vazio.
- **Grafo vazio** (por exemplo, "Só ciclos" num projeto sem ciclos): PNG, SVG e Mermaid ficam com `aria-disabled` e mostram o motivo como dica. JSON e badge continuam disponíveis.
- O menu só aparece na fase `ready`.

## 3. JSON completo (núcleo Rust)

`Analyzer::export_graph(&self) -> Option<GraphExport>`, que devolve `None` antes de `finish`. No WASM ele vira `exportGraph(): GraphExport | undefined`.

```jsonc
{
  "schema": "https://archviewer.viniciusbsarmento.com/schema/graph-v1.json",
  "version": 1,
  "project": "archviewer",
  "summary": { /* o Summary atual */ },
  "files": [{ "path": "src/a.ts", "language": "ts", "loc": 120, "package": "@acme/ui", "inCycle": false, "exports": ["run"] }],
  "externals": [{ "name": "react" }],
  "edges": [{ "from": "src/a.ts", "to": "react", "kind": "static", "external": true, "specifiers": ["useState"] }],
  "cycles": [["src/circular/a.ts", "src/circular/b.ts"]],
  "unresolved": [ /* UnresolvedImport */ ],
  "warnings": [ /* Warning */ ]
}
```

- Os caminhos funcionam como identificadores. `package` é o nome do pacote de workspace mais próximo acima do arquivo, ou `null`.
- A saída é **determinística**:
  - `files` vêm ordenados por caminho;
  - `externals`, por nome;
  - `edges`, por (`from`, `to`, `kind`);
  - dentro de cada ciclo, os caminhos são ordenados, e os ciclos são ordenados pelo primeiro caminho.
- Não existe `generatedAt`: o mesmo projeto gera exatamente o mesmo JSON.
- `version: 1`. Campos novos podem ser adicionados sem subir a versão.

## 4. Imagens (SVG e PNG)

- Um registro no próprio módulo, `export/scene.ts`, permite que o `GraphCanvas` registre a função que lê a cena atual (`registerSceneSource`), e que o menu a consulte. O `GraphCanvas` remove o registro ao desmontar.
- `sceneFromSigma(sigma, graph)` lê, para cada nó, a posição do layout (`x`, `y` do graphology) e a cor, a borda, o tamanho e o rótulo **depois dos reducers** (`getNodeDisplayData`). Para cada aresta lê cor, espessura e `hidden`, também depois dos reducers. O resultado é `Scene = { nodes: SceneNode[]; edges: SceneEdge[] }`.
- `buildSvg(scene, theme, opts?)` é uma função pura.
  - **Enquadramento:** todos os nós cabem, com margem de 40 px. A escala leva a maior dimensão a 1600 px, e o eixo y é invertido (no graphology y cresce para cima).
  - **Desenho:** fundo `paper`; arestas como `<line>` com `marker-end` em seta, omitindo as `hidden`; nós como `<circle>`, com `stroke` quando têm `borderColor`.
  - **Rótulos:** grupos e externos sempre têm rótulo. Arquivos têm rótulo enquanto a cena tiver no máximo 300 nós; acima disso, só os nós cujo rótulo sobreviveu aos reducers, ou seja, a seleção e os vizinhos quando há seleção.
  - **Escape e fonte:** os textos passam por escape XML. A fonte é `theme.labelFont` seguida de `system-ui, sans-serif`.
- `svgToPng(svg, scale = 2): Promise<Blob>` desenha o SVG num `<canvas>` via `Image` e exporta com `toBlob('image/png')`. Uma falha de carga ou um blob nulo vira um `Error`.

## 5. Mermaid

`toMermaid(r: Renderable): string` é uma função pura sobre o mesmo `renderable(graph, filters)` que o canvas usa.

- A saída começa com `flowchart LR`, e o id de cada nó é `n<id>`.
- **Formas:**
  - grupo: `["label/"]`;
  - arquivo: `("label")`;
  - externo: `{{"label"}}`.
- **Escape dos rótulos:** `"` vira `#quot;`, `<` vira `#lt;` e `>` vira `#gt;`.
- **Arestas:** `-->` normal e `-.->` quando é só de tipos. Com peso maior que 1, o peso vira rótulo: `-->|3|`.
- Arestas em ciclo recebem `linkStyle <i> stroke:#d33,stroke-width:2px`.
- O texto **sempre é copiado**. Acima de 500 arestas, o feedback avisa que o GitHub pode não renderizar o diagrama.

## 6. Badge

`badgeMarkdown(summary: Summary): string` gera o snippet sempre em inglês:

```markdown
[![architecture: 61 files · 0 cycles](https://img.shields.io/badge/architecture-61%20files%20%C2%B7%200%20cycles-2ea043)](https://archviewer.viniciusbsarmento.com)
```

- **Cor:** `2ea043` sem ciclos e `d4a72c` com ciclos.
- **Plural em inglês:** `1 file`, `1 cycle`.
- **Escape do shields:** `-` vira `--`, `_` vira `__`, e o resto passa por `encodeURIComponent`.
- O link não tem parâmetros de rastreio.

## 7. Erros

| Caso | Comportamento |
|---|---|
| Área de transferência ausente ou recusada | Diálogo de cópia manual |
| Falha ao rasterizar o PNG | Feedback com erro e detalhe; o resto da interface segue funcionando |
| `exportGraph` falha no worker ou devolve `undefined` | Feedback com erro |
| Nenhuma cena registrada (WebGL indisponível) | PNG e SVG desabilitados com o motivo |

## 8. Testes

- **Rust:** `export_graph` no `sample-project`, com snapshot `insta`. Ordem determinística (duas execuções iguais), `package` num fixture de monorepo, arestas para externos com `external: true`, ciclos ordenados, e `None` antes de `finish`.
- **core-wasm:** `exportGraph()` com campos camelCase e `undefined` antes de `finish`.
- **Vitest:**
  - `toMermaid`: formas, escape, só tipos, peso, ciclo e grafo vazio;
  - `badgeMarkdown`: escape, cor e singular;
  - `slugify`;
  - `buildSvg`: enquadramento dentro da área, rótulos abaixo e acima de 300 nós, arestas `hidden` omitidas, escape XML;
  - `ExportMenu`: teclado, `aria-live`, área de transferência mockada, diálogo de fallback, itens desabilitados e download (via `URL.createObjectURL` mockado), nos dois idiomas.
- **e2e:** baixar o JSON (8 arquivos, ciclo `a.ts`↔`b.ts`), baixar o PNG (assinatura `\x89PNG`) e copiar o Mermaid (começa com `flowchart LR`).

## 9. Documentação

O README ganha o recurso "Export". Ao final, o item "Export and share" é marcado na issue #8.
