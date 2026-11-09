import type { GraphExport } from '@archviewer/core-wasm';

export type EdgeRef = { from: string; to: string; external: boolean };
export type FanInChange = { path: string; before: number; after: number };

export type GraphDiff = {
  filesAdded: string[];
  filesRemoved: string[];
  externalsAdded: string[];
  externalsRemoved: string[];
  edgesAdded: EdgeRef[];
  edgesRemoved: EdgeRef[];
  cyclesAdded: string[][];
  cyclesResolved: string[][];
  fanInChanges: FanInChange[];
  newlyUnused: string[];
  /** after − before. */
  summary: { files: number; edges: number; cycles: number; externals: number; unused: number };
  changeCount: number;
};

const FAN_IN_TOP = 10;

/** Pasta do caminho; `.` para arquivos na raiz. */
export const dirname = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort(byText);

/** Arestas pelo par `from → to` (o tipo do import não importa). */
function edgeMap(g: GraphExport): Map<string, EdgeRef> {
  const m = new Map<string, EdgeRef>();
  for (const e of g.edges) m.set(`${e.from}\n${e.to}`, { from: e.from, to: e.to, external: e.external });
  return m;
}

function edgeDiff(a: Map<string, EdgeRef>, b: Map<string, EdgeRef>): EdgeRef[] {
  return [...a]
    .filter(([k]) => !b.has(k))
    .map(([, e]) => e)
    .sort((x, y) => byText(x.from, y.from) || byText(x.to, y.to));
}

/** Ciclos pelo conjunto de arquivos, independente da ordem. */
function cycleMap(g: GraphExport): Map<string, string[]> {
  return new Map(
    g.cycles.map((c) => {
      const sorted = [...c].sort(byText);
      return [sorted.join('\n'), sorted];
    }),
  );
}

function cycleDiff(a: Map<string, string[]>, b: Map<string, string[]>): string[][] {
  return [...a]
    .filter(([k]) => !b.has(k))
    .map(([, c]) => c)
    .sort((x, y) => byText(x.join('\n'), y.join('\n')));
}

/** Importadores distintos por arquivo, só entre arquivos. */
function fanIn(g: GraphExport): Map<string, number> {
  const importers = new Map<string, Set<string>>();
  for (const e of g.edges) {
    if (e.external) continue;
    let s = importers.get(e.to);
    if (!s) importers.set(e.to, (s = new Set()));
    s.add(e.from);
  }
  return new Map([...importers].map(([k, v]) => [k, v.size]));
}

const unusedOf = (g: GraphExport): string[] =>
  (g as Partial<Pick<GraphExport, 'deadCode'>>).deadCode?.unusedFiles ?? [];

/** O que mudou de `before` para `after`: dois exports completos do ArchViewer. */
export function diffGraphs(before: GraphExport, after: GraphExport): GraphDiff {
  const filesB = new Set(before.files.map((f) => f.path));
  const filesA = new Set(after.files.map((f) => f.path));
  const extB = new Set(before.externals.map((e) => e.name));
  const extA = new Set(after.externals.map((e) => e.name));
  const edgesB = edgeMap(before);
  const edgesA = edgeMap(after);
  const cyclesB = cycleMap(before);
  const cyclesA = cycleMap(after);

  const fanB = fanIn(before);
  const fanA = fanIn(after);
  const fanInChanges = [...filesA]
    .filter((p) => filesB.has(p))
    .map((path) => ({ path, before: fanB.get(path) ?? 0, after: fanA.get(path) ?? 0 }))
    .filter((c) => c.before !== c.after)
    .sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || byText(x.path, y.path))
    .slice(0, FAN_IN_TOP);

  const unusedB = new Set(unusedOf(before));
  const unusedA = new Set(unusedOf(after));

  const diff = {
    filesAdded: minus(filesA, filesB),
    filesRemoved: minus(filesB, filesA),
    externalsAdded: minus(extA, extB),
    externalsRemoved: minus(extB, extA),
    edgesAdded: edgeDiff(edgesA, edgesB),
    edgesRemoved: edgeDiff(edgesB, edgesA),
    cyclesAdded: cycleDiff(cyclesA, cyclesB),
    cyclesResolved: cycleDiff(cyclesB, cyclesA),
    fanInChanges,
    newlyUnused: minus(unusedA, unusedB),
    summary: {
      files: filesA.size - filesB.size,
      edges: edgesA.size - edgesB.size,
      cycles: cyclesA.size - cyclesB.size,
      externals: extA.size - extB.size,
      unused: unusedA.size - unusedB.size,
    },
  };
  const changeCount =
    diff.filesAdded.length +
    diff.filesRemoved.length +
    diff.externalsAdded.length +
    diff.externalsRemoved.length +
    diff.edgesAdded.length +
    diff.edgesRemoved.length +
    diff.cyclesAdded.length +
    diff.cyclesResolved.length;
  return { ...diff, changeCount };
}
