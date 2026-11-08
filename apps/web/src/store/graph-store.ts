import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Detail, Issues, SearchHit, Summary, VisibleGraph } from '@archviewer/core-wasm';
import { createAnalysisClient, type AnalysisApi } from '../analysis/client';
import { scan } from '../ingest/scan';
import { readInto, type IngestSkip, type ReadProgress } from '../ingest/read';
import type { DirSource } from '../ingest/source';
import { readFilters, writeFilters } from './url';

export type Phase = 'empty' | 'scanning' | 'confirm' | 'reading' | 'analyzing' | 'ready' | 'error';
export type Filters = {
  hideExternals: boolean;
  hideTypeOnly: boolean;
  hideAssets: boolean;
  cyclesOnly: boolean;
};

export interface GraphState {
  phase: Phase;
  error: string | null;
  projectName: string | null;
  fallback: boolean;
  source: DirSource | null;
  pendingCount: number;
  progress: ReadProgress | null;
  elapsedMs: number | null;
  summary: Summary | null;
  issues: Issues | null;
  ingestSkipped: IngestSkip[];
  graph: VisibleGraph;
  expanded: number[];
  selected: number | null;
  detail: Detail | null;
  filters: Filters;
  focusRequest: { id: number; seq: number } | null;
  openProject(source: DirSource, fallback: boolean): Promise<void>;
  confirmLarge(proceed: boolean): void;
  cancel(): void;
  toggle(id: number): Promise<void>;
  select(id: number | null): Promise<void>;
  reveal(hit: SearchHit): Promise<void>;
  setFilter<K extends keyof Filters>(k: K, v: boolean): void;
  reset(): void;
}

const LARGE_PROJECT = 10_000;
const MAX_FILE_BYTES = 2_097_152;
const BATCH_FILES = 200;
const BATCH_BYTES = 4_194_304;

const emptyGraph = (): VisibleGraph => ({ nodes: [], edges: [] });
const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function initialFilters(): Filters {
  try {
    return readFilters(typeof location === 'undefined' ? '' : location.search);
  } catch {
    return readFilters('');
  }
}

function writeUrl(f: Filters): void {
  try {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    history.replaceState(history.state, '', `${location.pathname}${writeFilters(f)}${location.hash}`);
  } catch {
    // ambiente sem history: a URL é só uma conveniência.
  }
}

type DataState = Omit<
  GraphState,
  | 'openProject'
  | 'confirmLarge'
  | 'cancel'
  | 'toggle'
  | 'select'
  | 'reveal'
  | 'setFilter'
  | 'reset'
  | 'filters'
>;

const initialData = (): DataState => ({
  phase: 'empty',
  error: null,
  projectName: null,
  fallback: false,
  source: null,
  pendingCount: 0,
  progress: null,
  elapsedMs: null,
  summary: null,
  issues: null,
  ingestSkipped: [],
  graph: emptyGraph(),
  expanded: [],
  selected: null,
  detail: null,
  focusRequest: null,
});

export function createGraphStore(deps: { api: () => AnalysisApi; now?: () => number }): StoreApi<GraphState> {
  const now = deps.now ?? (() => performance.now());

  let client: AnalysisApi | null = null;
  let unsubCrash: (() => void) | null = null;
  let abort: AbortController | null = null;
  let confirmResolve: ((proceed: boolean) => void) | null = null;
  let generation = 0;
  let viewSeq = 0;
  let detailSeq = 0;
  /** Grupos recolhidos cujo resultado ainda não pousou; candidatos à seleção órfã. */
  let collapsedPending: number[] = [];

  /** Encerra a execução atual: invalida respostas pendentes e descarta o cliente. */
  const teardown = () => {
    generation++;
    viewSeq++;
    detailSeq++;
    collapsedPending = [];
    abort?.abort();
    abort = null;
    unsubCrash?.();
    unsubCrash = null;
    const pendingConfirm = confirmResolve;
    confirmResolve = null;
    pendingConfirm?.(false);
    const c = client;
    client = null;
    c?.dispose();
  };

  return createStore<GraphState>()((set, get) => {
    const fail = (gen: number, msg: string) => {
      if (gen !== generation) return;
      teardown();
      set({ phase: 'error', error: msg });
    };

    const loadDetail = async (id: number | null): Promise<void> => {
      const my = ++detailSeq;
      const c = client;
      set({ selected: id, detail: null });
      if (id === null || !c) return;
      try {
        const d = await c.detail(id);
        if (my === detailSeq) set({ detail: d });
      } catch {
        // falha de worker chega por onCrash; aqui o painel só fica sem detalhe.
      }
    };

    /** Aplica uma nova expansão; descarta a resposta se um pedido mais novo saiu. */
    const applyView = async (expanded: number[]): Promise<boolean> => {
      const c = client;
      if (!c) return false;
      const gen = generation;
      const my = ++viewSeq;
      set({ expanded });
      try {
        const graph = await c.view(expanded);
        if (gen !== generation || my !== viewSeq) return false;
        set({ graph });
        const { selected } = get();
        const candidates = collapsedPending;
        collapsedPending = [];
        if (selected !== null && !graph.nodes.some((n) => n.id === selected)) {
          const target = candidates.find((id) => graph.nodes.some((n) => n.id === id));
          if (target !== undefined) await loadDetail(target);
        }
        return true;
      } catch (e) {
        fail(gen, message(e));
        return false;
      }
    };

    return {
      ...initialData(),
      filters: initialFilters(),

      async openProject(source, fallback) {
        teardown();
        const gen = generation;
        const c = deps.api();
        client = c;
        const ac = new AbortController();
        abort = ac;
        unsubCrash = c.onCrash((m) => fail(gen, m));
        const t0 = now();
        set({
          ...initialData(),
          phase: 'scanning',
          projectName: source.name || 'projeto',
          fallback,
          source,
        });
        try {
          await c.start(source.name);
          const dirs = await c.ignoredDirs();
          const files = await scan(source, { ignoredDirs: dirs, signal: ac.signal });
          const ok = await c.filterIngestible(files.map((f) => f.path));
          if (gen !== generation) return;
          const ingestible = files.filter((_, i) => ok[i]);

          if (ingestible.length > LARGE_PROJECT) {
            set({ phase: 'confirm', pendingCount: ingestible.length });
            const proceed = await new Promise<boolean>((resolve) => {
              confirmResolve = resolve;
            });
            if (gen !== generation) return;
            if (!proceed) {
              get().reset();
              return;
            }
            set({ pendingCount: 0 });
          }

          set({ phase: 'reading', progress: { read: 0, total: ingestible.length } });
          const { skipped } = await readInto(source, ingestible, (b) => c.addFiles(b), {
            maxFileBytes: MAX_FILE_BYTES,
            batchFiles: BATCH_FILES,
            batchBytes: BATCH_BYTES,
            signal: ac.signal,
            onProgress: (p) => {
              if (gen === generation) set({ progress: p });
            },
          });
          if (gen !== generation) return;

          set({ phase: 'analyzing', ingestSkipped: skipped });
          const fin = await c.finish();
          if (gen !== generation) return;
          const my = ++viewSeq;
          const graph = await c.view(fin.defaultExpansion);
          if (gen !== generation || my !== viewSeq) return;
          set({
            phase: 'ready',
            summary: fin.summary,
            issues: fin.issues,
            graph,
            expanded: union([], fin.defaultExpansion),
            elapsedMs: now() - t0,
          });
        } catch (e) {
          if (gen !== generation) return;
          if (isAbort(e)) {
            get().reset();
            return;
          }
          fail(gen, message(e));
        }
      },

      confirmLarge(proceed) {
        if (get().phase !== 'confirm') return;
        if (proceed) {
          const r = confirmResolve;
          confirmResolve = null;
          r?.(true);
        } else {
          get().reset();
        }
      },

      cancel() {
        get().reset();
      },

      async toggle(id) {
        const { expanded, graph } = get();
        if (expanded.includes(id)) {
          collapsedPending.push(id);
          await applyView(expanded.filter((x) => x !== id));
          return;
        }
        const node = graph.nodes.find((n) => n.id === id);
        if (!node || !node.expandable) return;
        await applyView(union(expanded, [id]));
      },

      async select(id) {
        await loadDetail(id);
      },

      async reveal(hit) {
        const ok = await applyView(union(get().expanded, hit.ancestors));
        if (!ok) return;
        await get().select(hit.id);
        set((s) => ({ focusRequest: { id: hit.id, seq: (s.focusRequest?.seq ?? 0) + 1 } }));
      },

      setFilter(k, v) {
        const filters = { ...get().filters, [k]: v };
        set({ filters });
        writeUrl(filters);
      },

      reset() {
        teardown();
        set({ ...initialData() });
      },
    };
  });
}

export const defaultStore: StoreApi<GraphState> = createGraphStore({ api: createAnalysisClient });

const StoreContext = createContext<StoreApi<GraphState> | null>(null);

export function GraphStoreProvider(p: { store: StoreApi<GraphState>; children: ReactNode }) {
  return createElement(StoreContext.Provider, { value: p.store }, p.children);
}

export function useGraphStoreApi(): StoreApi<GraphState> {
  return useContext(StoreContext) ?? defaultStore;
}

export function useGraphStore<T>(selector: (s: GraphState) => T): T {
  return useStore(useGraphStoreApi(), selector);
}
