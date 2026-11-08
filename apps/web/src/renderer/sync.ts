import type Graph from 'graphology';
import type { VEdge, VNode } from '@archviewer/core-wasm';
import type { Renderable } from '../store/selectors';
import { placeChildren, type Point, type PositionCache } from './positions';
import type { GraphTheme } from './theme';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const nodeKey = (id: number) => String(id);
export const edgeKey = (from: number, to: number) => `${from}->${to}`;

function nodeVisual(n: VNode, theme: GraphTheme): Record<string, unknown> {
  const base = { label: n.label, nodeId: n.id, kind: n.kind, expandable: n.expandable, expanded: n.expanded };
  if (n.kind === 'group') {
    return {
      ...base,
      type: 'border',
      size: clamp(6 + 2 * Math.sqrt(n.size), 6, 28),
      color: theme.paper2,
      borderColor: theme.rule2,
    };
  }
  if (n.kind === 'external') {
    return { ...base, type: 'border', size: clamp(3 + Math.sqrt(n.size) / 2, 3, 10), color: theme.paper, borderColor: theme.muted };
  }
  return { ...base, type: 'circle', size: clamp(3 + Math.sqrt(n.size) / 2, 3, 10), color: theme.ink2 };
}

function edgeVisual(e: VEdge, theme: GraphTheme): Record<string, unknown> {
  // Ciclo: +1 de espessura (máx. 7) no lugar do tracejado que o Sigma 3 não tem (desvio consciente).
  const size = clamp(1 + Math.log2(Math.max(1, e.weight)), 1, 6);
  return {
    size: e.inCycle ? size + 1 : size,
    color: e.inCycle ? theme.error : e.typeOnly ? theme.muted : theme.rule2,
  };
}

/**
 * Alinha o graphology com o que deve ser desenhado. Nós que saem têm a posição guardada antes;
 * nós novos nascem na posição guardada, ou em volta do pai, ou numa espiral mínima perto da origem
 * (posições idênticas nunca se separam no FA2).
 */
export function syncGraph(
  g: Graph,
  r: Renderable,
  cache: PositionCache,
  theme: GraphTheme,
): { added: number[]; removed: number[] } {
  const wantNodes = new Map(r.nodes.map((n) => [nodeKey(n.id), n]));
  const wantEdges = new Map(r.edges.map((e) => [edgeKey(e.from, e.to), e]));

  g.forEachEdge((key) => {
    if (!wantEdges.has(key)) g.dropEdge(key);
  });

  const removed: number[] = [];
  for (const key of g.nodes()) {
    if (wantNodes.has(key)) continue;
    const a = g.getNodeAttributes(key);
    const id = a.nodeId as number;
    cache.set(id, a.x as number, a.y as number);
    removed.push(id);
    g.dropNode(key);
  }

  const fresh = r.nodes.filter((n) => !g.hasNode(nodeKey(n.id)));
  const spots = new Map<number, Point>();
  const byParent = new Map<number, number[]>();
  const loose: number[] = [];
  for (const n of fresh) {
    const cached = cache.get(n.id);
    if (cached) {
      spots.set(n.id, cached);
      continue;
    }
    const parent = n.parentId === undefined ? undefined : liveOrCached(g, cache, n.parentId);
    if (parent && n.parentId !== undefined) {
      const list = byParent.get(n.parentId);
      if (list) list.push(n.id);
      else byParent.set(n.parentId, [n.id]);
    } else {
      loose.push(n.id);
    }
  }
  for (const [parentId, ids] of byParent) {
    const parent = liveOrCached(g, cache, parentId)!;
    for (const [id, p] of placeChildren(parent, ids)) spots.set(id, p);
  }
  loose.sort((a, b) => a - b).forEach((id, i) => {
    const angle = i * 2.399963229728653; // ângulo áureo
    const radius = 2 * Math.sqrt(i);
    spots.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });

  const added: number[] = [];
  for (const n of fresh) {
    const p = spots.get(n.id)!;
    g.addNode(nodeKey(n.id), { ...nodeVisual(n, theme), x: p.x, y: p.y });
    added.push(n.id);
  }
  for (const n of r.nodes) {
    if (!added.includes(n.id)) g.mergeNodeAttributes(nodeKey(n.id), nodeVisual(n, theme));
  }

  for (const [key, e] of wantEdges) {
    const from = nodeKey(e.from);
    const to = nodeKey(e.to);
    if (!g.hasNode(from) || !g.hasNode(to)) continue;
    if (g.hasEdge(key)) g.mergeEdgeAttributes(key, edgeVisual(e, theme));
    else g.addEdgeWithKey(key, from, to, edgeVisual(e, theme));
  }

  return { added, removed };
}

function liveOrCached(g: Graph, cache: PositionCache, id: number): Point | undefined {
  const key = nodeKey(id);
  if (g.hasNode(key)) return { x: g.getNodeAttribute(key, 'x') as number, y: g.getNodeAttribute(key, 'y') as number };
  return cache.get(id);
}
