// @vitest-environment node
import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { VEdge, VNode } from '@archviewer/core-wasm';
import { PositionCache } from '../../src/renderer/positions';
import { syncGraph } from '../../src/renderer/sync';
import type { GraphTheme } from '../../src/renderer/theme';

const theme: GraphTheme = {
  paper: 'rgb(1, 1, 1)',
  paper2: 'rgb(2, 2, 2)',
  ink: 'rgb(3, 3, 3)',
  ink2: 'rgb(4, 4, 4)',
  muted: 'rgb(5, 5, 5)',
  rule: 'rgb(6, 6, 6)',
  rule2: 'rgb(7, 7, 7)',
  accent: 'rgb(8, 8, 8)',
  accentWash: 'rgb(9, 9, 9)',
  error: 'rgb(10, 10, 10)',
  labelFont: 'sans-serif',
};

const node = (id: number, kind: VNode['kind'], extra: Partial<VNode> = {}): VNode => ({
  id,
  kind,
  label: `n${id}`,
  path: `p${id}`,
  parentId: undefined,
  size: 4,
  inCycle: false,
  expandable: false,
  expanded: false,
  ...extra,
});
const edge = (from: number, to: number, extra: Partial<VEdge> = {}): VEdge => ({
  from,
  to,
  weight: 1,
  inCycle: false,
  typeOnly: false,
  ...extra,
});

const collapsed = {
  nodes: [node(1, 'file'), node(5, 'group', { parentId: 0, expandable: true }), node(9, 'external')],
  edges: [edge(1, 5, { inCycle: true }), edge(1, 9, { typeOnly: true })],
};
const expandedR = {
  nodes: [node(1, 'file'), node(6, 'file', { parentId: 5 }), node(7, 'file', { parentId: 5 }), node(9, 'external')],
  edges: [edge(1, 6), edge(6, 7)],
};

const mk = () => new Graph({ multi: false, type: 'directed' });

describe('syncGraph', () => {
  it('adds everything on first call with visual attributes', () => {
    const g = mk();
    const res = syncGraph(g, collapsed, new PositionCache(), theme);
    expect([...res.added].sort()).toEqual([1, 5, 9]);
    expect(res.removed).toEqual([]);
    expect(g.order).toBe(3);
    expect(g.getNodeAttribute('5', 'type')).toBe('border');
    expect(g.getNodeAttribute('5', 'color')).toBe(theme.paper2);
    expect(g.getNodeAttribute('5', 'borderColor')).toBe(theme.rule2);
    expect(g.getNodeAttribute('1', 'color')).toBe(theme.ink2);
    expect(g.getNodeAttribute('9', 'borderColor')).toBe(theme.muted);
    expect(g.getNodeAttribute('1', 'nodeId')).toBe(1);
    expect(g.getEdgeAttribute('1->5', 'color')).toBe(theme.error);
    expect(g.getEdgeAttribute('1->9', 'color')).toBe(theme.muted);
  });

  it('arestas de ciclo ficam 1 mais grossas (até 7); as outras até 6', () => {
    const g = mk();
    const r = {
      nodes: [node(1, 'file'), node(2, 'file'), node(3, 'file')],
      edges: [
        edge(1, 2, { inCycle: true }),
        edge(2, 1, { inCycle: true, weight: 1024 }),
        edge(1, 3),
        edge(3, 2, { weight: 1024 }),
      ],
    };
    syncGraph(g, r, new PositionCache(), theme);
    expect(g.getEdgeAttribute('1->2', 'size')).toBe(2);
    expect(g.getEdgeAttribute('2->1', 'size')).toBe(7);
    expect(g.getEdgeAttribute('1->3', 'size')).toBe(1);
    expect(g.getEdgeAttribute('3->2', 'size')).toBe(6);
  });

  it('expands, collapses and re-expands around cached positions', () => {
    const g = mk();
    const cache = new PositionCache();
    syncGraph(g, collapsed, cache, theme);
    g.setNodeAttribute('5', 'x', 100);
    g.setNodeAttribute('5', 'y', 200);

    const exp = syncGraph(g, expandedR, cache, theme);
    expect(exp.removed).toEqual([5]);
    expect([...exp.added].sort()).toEqual([6, 7]);
    expect(g.hasNode('5')).toBe(false);
    for (const k of ['6', '7']) {
      const d = Math.hypot(g.getNodeAttribute(k, 'x') - 100, g.getNodeAttribute(k, 'y') - 200);
      expect(d).toBeCloseTo(10 + 4 * Math.sqrt(2), 6);
    }
    g.setNodeAttribute('6', 'x', 11);
    g.setNodeAttribute('6', 'y', 12);
    g.setNodeAttribute('7', 'x', 21);
    g.setNodeAttribute('7', 'y', 22);

    const col = syncGraph(g, collapsed, cache, theme);
    expect([...col.removed].sort()).toEqual([6, 7]);
    expect(col.added).toEqual([5]);
    expect(g.getNodeAttribute('5', 'x')).toBe(100);
    expect(g.getNodeAttribute('5', 'y')).toBe(200);

    syncGraph(g, expandedR, cache, theme);
    expect([g.getNodeAttribute('6', 'x'), g.getNodeAttribute('6', 'y')]).toEqual([11, 12]);
    expect([g.getNodeAttribute('7', 'x'), g.getNodeAttribute('7', 'y')]).toEqual([21, 22]);
  });

  it('no-op update keeps positions and reports nothing', () => {
    const g = mk();
    const cache = new PositionCache();
    syncGraph(g, collapsed, cache, theme);
    g.setNodeAttribute('1', 'x', 42);
    g.setNodeAttribute('1', 'y', 43);
    const res = syncGraph(g, collapsed, cache, theme);
    expect(res).toEqual({ added: [], removed: [] });
    expect(g.getNodeAttribute('1', 'x')).toBe(42);
    expect(g.getNodeAttribute('1', 'y')).toBe(43);
  });
});
