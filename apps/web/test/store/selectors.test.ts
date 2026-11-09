import { describe, expect, it } from 'vitest';
import type { Issues, VEdge, VNode, VisibleGraph } from '@archviewer/core-wasm';
import { explorerRows, renderable, visibleUnresolved } from '../../src/store/selectors';
import type { Filters } from '../../src/store/graph-store';

const none: Filters = { hideExternals: false, hideTypeOnly: false, hideAssets: false, cyclesOnly: false };
const n = (id: number, o: Partial<VNode> = {}): VNode => ({
  id,
  kind: 'file',
  label: `n${id}`,
  path: `n${id}`,
  size: 1,
  parentId: 0,
  inCycle: false,
  expandable: false,
  expanded: false,
  metrics: { fanIn: 0, fanOut: 0, loc: 0, unused: 0 },
  ...o,
});
const e = (from: number, to: number, o: Partial<VEdge> = {}): VEdge => ({
  from,
  to,
  weight: 1,
  inCycle: false,
  typeOnly: false,
  ...o,
});

describe('renderable', () => {
  const g: VisibleGraph = {
    nodes: [
      n(0, { kind: 'group', expanded: true, parentId: undefined }),
      n(1, { inCycle: true }),
      n(2, { inCycle: true }),
      n(3, { kind: 'external' }),
      n(4),
    ],
    edges: [e(1, 2, { inCycle: true }), e(2, 1, { inCycle: true, typeOnly: true }), e(1, 3), e(4, 1)],
  };
  it('tira nós expandidos', () => {
    const r = renderable(g, none);
    expect(r.nodes.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(r.edges).toHaveLength(4);
  });
  it('hideExternals tira nós e arestas', () => {
    const r = renderable(g, { ...none, hideExternals: true });
    expect(r.nodes.map((x) => x.id)).toEqual([1, 2, 4]);
    expect(r.edges.some((x) => x.to === 3)).toBe(false);
  });
  it('hideTypeOnly tira arestas typeOnly', () => {
    const r = renderable(g, { ...none, hideTypeOnly: true });
    expect(r.edges.some((x) => x.typeOnly)).toBe(false);
    expect(r.nodes).toHaveLength(4);
  });
  it('cyclesOnly mantém só ciclo, sem arestas soltas', () => {
    const r = renderable(g, { ...none, cyclesOnly: true });
    expect(r.nodes.map((x) => x.id)).toEqual([1, 2]);
    expect(r.edges.every((x) => x.inCycle)).toBe(true);
    expect(r.edges).toHaveLength(2);
  });
  it('nenhuma aresta aponta para nó removido', () => {
    const r = renderable(g, { ...none, hideExternals: true, cyclesOnly: true });
    const ids = new Set(r.nodes.map((x) => x.id));
    expect(r.edges.every((x) => ids.has(x.from) && ids.has(x.to))).toBe(true);
  });
});

describe('explorerRows', () => {
  it('pré-ordem por label, externos no fim com depth 0', () => {
    const g: VisibleGraph = {
      nodes: [
        n(0, { kind: 'group', expanded: true, parentId: undefined, label: 'root' }),
        n(1, { kind: 'group', label: 'src', expanded: true }),
        n(2, { label: 'b.ts', parentId: 1 }),
        n(3, { label: 'a.ts', parentId: 1 }),
        n(4, { label: 'z.ts' }),
        n(5, { kind: 'external', label: 'react', parentId: undefined }),
        n(6, { kind: 'external', label: 'axios', parentId: undefined }),
      ],
      edges: [],
    };
    const rows = explorerRows(g).map((r) => [r.node.label, r.depth]);
    expect(rows).toEqual([
      ['src', 0],
      ['a.ts', 1],
      ['b.ts', 1],
      ['z.ts', 0],
      ['axios', 0],
      ['react', 0],
    ]);
  });
  it('grafo vazio', () => {
    expect(explorerRows({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('visibleUnresolved', () => {
  const issues: Issues = {
    unresolved: [
      { from: 'a.ts', specifier: './x.png', reason: 'asset' },
      { from: 'a.ts', specifier: './y', reason: 'notFound' },
    ],
    skipped: [],
    parseErrors: [],
    warnings: [],
  };
  it('hideAssets filtra assets', () => {
    expect(visibleUnresolved(issues, none)).toHaveLength(2);
    expect(visibleUnresolved(issues, { ...none, hideAssets: true }).map((u) => u.reason)).toEqual(['notFound']);
  });
});
