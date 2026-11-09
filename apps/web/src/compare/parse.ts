import type { GraphExport } from '@archviewer/core-wasm';

export const GRAPH_SCHEMA = 'https://archviewer.viniciusbsarmento.com/schema/graph-v1.json';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arrayOf = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);
const str = (v: unknown) => typeof v === 'string';

/** Lê um JSON exportado pelo ArchViewer; qualquer coisa fora do formato v1 é recusada. */
export function parseExport(text: string): { ok: true; graph: GraphExport } | { ok: false } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObject(v) || v.version !== 1 || v.schema !== GRAPH_SCHEMA || !str(v.project) || !isObject(v.summary)) {
    return { ok: false };
  }
  const shapes =
    arrayOf(v.files, (f) => isObject(f) && str(f.path)) &&
    arrayOf(v.externals, (e) => isObject(e) && str(e.name)) &&
    arrayOf(v.edges, (e) => isObject(e) && str(e.from) && str(e.to) && typeof e.external === 'boolean') &&
    arrayOf(v.cycles, (c) => arrayOf(c, str));
  return shapes ? { ok: true, graph: v as unknown as GraphExport } : { ok: false };
}
