import type { VEdge, VNode } from '@archviewer/core-wasm';
import { describe, expect, it } from 'vitest';
import { toMermaid } from '../../src/export/mermaid';

const node = (id: number, o: Partial<VNode> = {}): VNode => ({
  id,
  kind: 'file',
  label: `f${id}.ts`,
  path: `src/f${id}.ts`,
  size: 1,
  parentId: 0,
  inCycle: false,
  expandable: false,
  expanded: false,
  ...o,
});
const edge = (from: number, to: number, o: Partial<VEdge> = {}): VEdge => ({
  from,
  to,
  weight: 1,
  inCycle: false,
  typeOnly: false,
  ...o,
});

describe('toMermaid', () => {
  it('desenha grupos, arquivos e externos com formas próprias', () => {
    const { text } = toMermaid({
      nodes: [
        node(1, { kind: 'group', label: 'src', path: 'src' }),
        node(2, { label: 'a.ts' }),
        node(3, { kind: 'external', label: 'react', parentId: undefined }),
      ],
      edges: [],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('flowchart LR');
    expect(text).toContain('n1["src/"]');
    expect(text).toContain('n2("a.ts")');
    expect(text).toContain('n3{{"react"}}');
  });

  it('só tipos é pontilhada, peso vira rótulo e ciclo ganha linkStyle', () => {
    const { text, edges } = toMermaid({
      nodes: [node(1), node(2), node(3)],
      edges: [edge(1, 2, { weight: 3 }), edge(2, 3, { typeOnly: true }), edge(3, 1, { inCycle: true })],
    });
    expect(edges).toBe(3);
    expect(text).toContain('n1 -->|3| n2');
    expect(text).toContain('n2 -.-> n3');
    expect(text).toContain('n3 --> n1');
    expect(text).toContain('linkStyle 2 stroke:#d33,stroke-width:2px');
    expect(text).not.toContain('linkStyle 0');
  });

  it('escapa aspas e sinais de maior/menor nos rótulos', () => {
    const { text } = toMermaid({ nodes: [node(1, { label: 'x"y<z>' })], edges: [] });
    expect(text).toContain('n1("x#quot;y#lt;z#gt;")');
  });

  it('grafo vazio vira só o cabeçalho', () => {
    expect(toMermaid({ nodes: [], edges: [] })).toEqual({ text: 'flowchart LR', edges: 0 });
  });
});
