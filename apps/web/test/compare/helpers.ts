import type { ExportEdge, GraphExport } from '@archviewer/core-wasm';

type Lite = {
  files?: string[];
  externals?: string[];
  edges?: [string, string, ExportEdge['kind']?][];
  cycles?: string[][];
  unused?: string[] | null;
};

/** Export mínimo: arestas para nomes em `externals` viram externas. */
export function g(o: Lite = {}): GraphExport {
  const files = o.files ?? ['src/a.ts', 'src/b.ts'];
  const externals = o.externals ?? [];
  const edges = (o.edges ?? []).map(([from, to, kind]) => ({
    from,
    to,
    kind: kind ?? 'static',
    external: externals.includes(to),
    specifiers: [],
  }));
  const graph = {
    schema: 'https://archviewer.viniciusbsarmento.com/schema/graph-v1.json',
    version: 1,
    project: 'p',
    summary: {
      files: files.length,
      edges: edges.length,
      cycles: (o.cycles ?? []).length,
      externals: externals.length,
      unresolved: 0,
      skipped: 0,
      parseErrors: 0,
      workspacePackages: 0,
      warnings: [],
    },
    files: files.map((path) => ({ path, language: 'ts', loc: 1, package: undefined, inCycle: false, exports: [] })),
    externals: externals.map((name) => ({ name })),
    edges,
    cycles: o.cycles ?? [],
    unresolved: [],
    warnings: [],
    deadCode: { entries: [], unusedFiles: o.unused ?? [], testOnlyFiles: [], unusedExports: [], fallback: false },
  } as unknown as GraphExport;
  if (o.unused === null) delete (graph as { deadCode?: unknown }).deadCode;
  return graph;
}
