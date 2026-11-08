import type { Issues, UnresolvedImport, VEdge, VNode, VisibleGraph } from '@archviewer/core-wasm';
import type { Filters } from './graph-store';

export type Renderable = { nodes: VNode[]; edges: VEdge[] };

export function renderable(graph: VisibleGraph, filters: Filters): Renderable {
  const nodes = graph.nodes.filter((n) => {
    if (n.expanded) return false;
    if (filters.hideExternals && n.kind === 'external') return false;
    if (filters.cyclesOnly && !n.inCycle) return false;
    return true;
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => {
    if (!ids.has(e.from) || !ids.has(e.to)) return false;
    if (filters.hideTypeOnly && e.typeOnly) return false;
    if (filters.cyclesOnly && !e.inCycle) return false;
    return true;
  });
  return { nodes, edges };
}

export type ExplorerRow = { node: VNode; depth: number };

const byLabel = (a: VNode, b: VNode) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

export function explorerRows(graph: VisibleGraph): ExplorerRow[] {
  const children = new Map<number, VNode[]>();
  const externals: VNode[] = [];
  for (const n of graph.nodes) {
    if (n.kind === 'external') {
      externals.push(n);
      continue;
    }
    if (n.parentId === undefined) continue; // a raiz
    const list = children.get(n.parentId);
    if (list) list.push(n);
    else children.set(n.parentId, [n]);
  }
  const rootId = graph.nodes.find((n) => n.kind !== 'external' && n.parentId === undefined)?.id ?? 0;
  const rows: ExplorerRow[] = [];
  const walk = (id: number, depth: number) => {
    for (const n of (children.get(id) ?? []).sort(byLabel)) {
      rows.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(rootId, 0);
  for (const n of externals.sort(byLabel)) rows.push({ node: n, depth: 0 });
  return rows;
}

export function visibleUnresolved(issues: Issues, filters: Filters): UnresolvedImport[] {
  return filters.hideAssets ? issues.unresolved.filter((u) => u.reason !== 'asset') : issues.unresolved;
}
