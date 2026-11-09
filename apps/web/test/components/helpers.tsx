import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type {
  AddResult,
  DeadCode,
  Detail,
  FileInput,
  GraphExport,
  Issues,
  SearchHit,
  Summary,
  VNode,
  VisibleGraph,
} from '@archviewer/core-wasm';
import type { AnalysisApi, FinishResult } from '../../src/analysis/client';
import { memorySource, type DirSource } from '../../src/ingest/source';
import { createGraphStore, GraphStoreProvider, type GraphState } from '../../src/store/graph-store';
import type { StoreApi } from 'zustand/vanilla';

export const vnode = (id: number, o: Partial<VNode> = {}): VNode => ({
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

/** 0 raiz; 1 `src` (grupo expandido); 2 `src/a.ts`; 3 `src/b.ts`; 4 `lib` (grupo recolhido); 9 `react` externo. */
export function sampleGraph(): VisibleGraph {
  return {
    nodes: [
      vnode(0, { kind: 'group', label: 'proj', path: '', parentId: undefined, expandable: true, expanded: true }),
      vnode(1, { kind: 'group', label: 'src', path: 'src', expandable: true, expanded: true }),
      vnode(2, { label: 'a.ts', path: 'src/a.ts', parentId: 1 }),
      vnode(3, { label: 'b.ts', path: 'src/b.ts', parentId: 1 }),
      vnode(4, { kind: 'group', label: 'lib', path: 'lib', expandable: true }),
      vnode(9, { kind: 'external', label: 'react', path: 'react', parentId: undefined }),
    ],
    edges: [],
  };
}

export const deadCode = (o: Partial<DeadCode> = {}): DeadCode => ({
  entries: [{ path: 'src/main.ts', reason: 'html' }],
  unusedFiles: ['src/old.ts', 'src/legacy/x.ts'],
  testOnlyFiles: ['src/fixtures.ts'],
  unusedExports: [{ path: 'src/a.ts', names: ['helper', 'default'] }],
  fallback: false,
  ...o,
});

export const summary = (o: Partial<Summary> = {}): Summary => ({
  files: 8,
  edges: 12,
  cycles: 1,
  externals: 2,
  unresolved: 1,
  skipped: 0,
  parseErrors: 0,
  workspacePackages: 0,
  warnings: [],
  ...o,
});

export const issues = (o: Partial<Issues> = {}): Issues => ({
  unresolved: [{ from: 'src/a.ts', specifier: './missing', reason: 'notFound' }],
  skipped: [],
  parseErrors: [],
  warnings: [],
  ...o,
});

export function makeApi(o: { hits?: SearchHit[]; finish?: Partial<FinishResult>; exportGraph?: GraphExport } = {}) {
  return {
    ignoredDirs: vi.fn(async () => ['node_modules']),
    start: vi.fn(async () => {}),
    filterIngestible: vi.fn(async (paths: string[]) => paths.map(() => true)),
    addFiles: vi.fn(async (b: FileInput[]): Promise<AddResult> => ({ accepted: b.length, skipped: 0 })),
    finish: vi.fn(
      async (): Promise<FinishResult> => ({
        summary: summary(),
        issues: issues(),
        defaultExpansion: [0, 1],
        deadCode: deadCode(),
        ...o.finish,
      }),
    ),
    view: vi.fn(async () => sampleGraph()),
    detail: vi.fn(async (): Promise<Detail | null> => null),
    find: vi.fn(async () => o.hits ?? []),
    exportGraph: vi.fn(async () => o.exportGraph ?? null),
    onCrash: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}
export type FakeApi = ReturnType<typeof makeApi>;

export function storeWith(api: FakeApi = makeApi()) {
  return createGraphStore({ api: () => api as unknown as AnalysisApi, now: () => 0 });
}

/** Store em `ready`, aberto pelo caminho real (`openProject`) sobre uma fonte em memória. */
export async function readyStore(api: FakeApi = makeApi(), source?: DirSource) {
  const store = storeWith(api);
  await store.getState().openProject(source ?? memorySource('proj', { 'src/a.ts': 'a', 'src/b.ts': 'b' }), false);
  return { store, api };
}

export function renderWith(store: StoreApi<GraphState>, ui: ReactElement) {
  return render(<GraphStoreProvider store={store}>{ui}</GraphStoreProvider>);
}
