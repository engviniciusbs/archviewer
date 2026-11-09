import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeadCode, Detail, GraphExport, Issues, SearchHit, Summary, VisibleGraph } from '@archviewer/core-wasm';
import { createAnalysisClient, type AnalysisApi } from '../analysis/client';
import { scan } from '../ingest/scan';
import { readInto, type IngestSkip, type ReadProgress } from '../ingest/read';
import type { DirSource } from '../ingest/source';
import { analyzeToExport } from '../compare/baseline';
import { diffGraphs, type GraphDiff } from '../compare/diff';
import { parseExport } from '../compare/parse';
import type { ColorBy } from '../renderer/heat';
import { readColorBy, readFilters, writeFilters } from './url';

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
  /** Entradas, arquivos sem uso e exports sem uso; null antes do fim da análise. */
  deadCode: DeadCode | null;
  ingestSkipped: IngestSkip[];
  graph: VisibleGraph;
  expanded: number[];
  selected: number | null;
  detail: Detail | null;
  /** Id cujo detalhe não pôde ser carregado (resposta nula ou falha); null = sem falha. */
  detailError: number | null;
  filters: Filters;
  /** Comparação ativa com outra versão; null sem comparação. */
  comparison: Comparison | null;
  comparePhase: ComparePhase;
  /** Métrica do heatmap; 'none' mantém as cores padrão. Vai para a URL como `color=`. */
  colorBy: ColorBy;
  focusRequest: { id: number; seq: number } | null;
  /** Busca ativa, compartilhada entre a toolbar e o explorador; null = sem busca. */
  searchResults: SearchResults | null;
  openProject(source: DirSource, fallback: boolean): Promise<void>;
  confirmLarge(proceed: boolean): void;
  cancel(): void;
  toggle(id: number): Promise<void>;
  select(id: number | null): Promise<void>;
  reveal(hit: SearchHit): Promise<void>;
  setFilter<K extends keyof Filters>(k: K, v: boolean): void;
  setColorBy(c: ColorBy): void;
  /** Compara o projeto aberto com um JSON exportado; false quando o arquivo não é um export válido. */
  compareWithExport(text: string, label: string): Promise<boolean>;
  /** Analisa outra pasta num cliente temporário e compara com o projeto aberto. */
  compareWithFolder(source: DirSource): Promise<void>;
  clearComparison(): void;
  /** Busca no cliente atual; [] sem projeto pronto, com busca vazia ou em falha. */
  search(query: string): Promise<SearchHit[]>;
  setSearchResults(r: SearchResults | null): void;
  /** Grafo completo de arquivos para exportação; null sem projeto pronto. Erros do worker sobem. */
  exportGraph(): Promise<GraphExport | null>;
  reset(): void;
}

export type SearchResults = { query: string; hits: SearchHit[] };
export type Comparison = { label: string; diff: GraphDiff; warning: 'projectMismatch' | null };
export type ComparePhase =
  | { status: 'idle' }
  | { status: 'loading'; read: number; total: number }
  | { status: 'error'; message: string };

const LARGE_PROJECT = 10_000;
const MAX_FILE_BYTES = 2_097_152;
const BATCH_FILES = 200;
const BATCH_BYTES = 4_194_304;
const SEARCH_LIMIT = 50;

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

function initialColorBy(): ColorBy {
  try {
    return readColorBy(typeof location === 'undefined' ? '' : location.search);
  } catch {
    return 'none';
  }
}

function writeUrl(f: Filters, c: ColorBy): void {
  try {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    history.replaceState(history.state, '', `${location.pathname}${writeFilters(f, c)}${location.hash}`);
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
  | 'setColorBy'
  | 'compareWithExport'
  | 'compareWithFolder'
  | 'clearComparison'
  | 'search'
  | 'setSearchResults'
  | 'exportGraph'
  | 'reset'
  | 'filters'
  | 'colorBy'
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
  deadCode: null,
  ingestSkipped: [],
  graph: emptyGraph(),
  expanded: [],
  selected: null,
  detail: null,
  detailError: null,
  focusRequest: null,
  searchResults: null,
  comparison: null,
  comparePhase: { status: 'idle' },
});

export function createGraphStore(deps: { api: () => AnalysisApi; now?: () => number }): StoreApi<GraphState> {
  const now = deps.now ?? (() => performance.now());

  let client: AnalysisApi | null = null;
  let unsubCrash: (() => void) | null = null;
  let abort: AbortController | null = null;
  let compareAbort: AbortController | null = null;
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
    compareAbort?.abort();
    compareAbort = null;
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
      set({ selected: id, detail: null, detailError: null });
      if (id === null || !c) return;
      try {
        const d = await c.detail(id);
        if (my === detailSeq) set(d ? { detail: d } : { detailError: id });
      } catch {
        // Queda do worker chega por onCrash (e o teardown invalida este pedido);
        // qualquer outra falha deixa o painel em erro para este id.
        if (my === detailSeq) set({ detailError: id });
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
      colorBy: initialColorBy(),

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
          colorBy: get().colorBy === 'changes' ? 'none' : get().colorBy,
          phase: 'scanning',
          projectName: source.name || 'projeto',
          fallback,
          source,
        });
        try {
          await c.start(source.name);
          const dirs = await c.ignoredDirs();
          const unreadableDirs: IngestSkip[] = [];
          const files = await scan(source, {
            ignoredDirs: dirs,
            signal: ac.signal,
            onUnreadable: (path) => unreadableDirs.push({ path, reason: 'unreadable' }),
          });
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

          set({ phase: 'analyzing', ingestSkipped: [...unreadableDirs, ...skipped] });
          const fin = await c.finish();
          if (gen !== generation) return;
          const my = ++viewSeq;
          const graph = await c.view(fin.defaultExpansion);
          if (gen !== generation || my !== viewSeq) return;
          set({
            phase: 'ready',
            summary: fin.summary,
            issues: fin.issues,
            deadCode: fin.deadCode,
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
        writeUrl(filters, get().colorBy);
      },

      setColorBy(colorBy) {
        if (colorBy === 'changes' && !get().comparison) return;
        set({ colorBy });
        writeUrl(get().filters, colorBy);
      },

      async compareWithExport(text, label) {
        const c = client;
        if (!c || get().phase !== 'ready') return false;
        const parsed = parseExport(text);
        if (!parsed.ok) {
          set({ comparePhase: { status: 'error', message: 'invalid' } });
          return false;
        }
        const gen = generation;
        try {
          const after = await c.exportGraph();
          if (gen !== generation) return false;
          if (!after) throw new Error('no analysis to compare');
          set({
            comparison: {
              label,
              diff: diffGraphs(parsed.graph, after),
              warning: parsed.graph.project === after.project ? null : 'projectMismatch',
            },
            comparePhase: { status: 'idle' },
          });
          return true;
        } catch (e) {
          if (gen === generation) set({ comparePhase: { status: 'error', message: message(e) } });
          return false;
        }
      },

      async compareWithFolder(source) {
        const c = client;
        if (!c || get().phase !== 'ready') return;
        const gen = generation;
        compareAbort?.abort();
        const ac = new AbortController();
        compareAbort = ac;
        const base = deps.api();
        set({ comparePhase: { status: 'loading', read: 0, total: 0 } });
        try {
          const before = await analyzeToExport(source, base, {
            maxFileBytes: MAX_FILE_BYTES,
            batchFiles: BATCH_FILES,
            batchBytes: BATCH_BYTES,
            signal: ac.signal,
            onProgress: (p) => {
              if (gen === generation && compareAbort === ac) set({ comparePhase: { status: 'loading', ...p } });
            },
          });
          if (gen !== generation || compareAbort !== ac) return;
          const after = await c.exportGraph();
          if (gen !== generation || compareAbort !== ac) return;
          if (!after) throw new Error('no analysis to compare');
          set({
            comparison: { label: source.name || 'folder', diff: diffGraphs(before, after), warning: null },
            comparePhase: { status: 'idle' },
          });
        } catch (e) {
          if (gen !== generation || compareAbort !== ac) return;
          set({ comparePhase: isAbort(e) ? { status: 'idle' } : { status: 'error', message: message(e) } });
        } finally {
          base.dispose();
          if (compareAbort === ac) compareAbort = null;
        }
      },

      clearComparison() {
        compareAbort?.abort();
        compareAbort = null;
        const colorBy = get().colorBy === 'changes' ? 'none' : get().colorBy;
        set({ comparison: null, comparePhase: { status: 'idle' }, colorBy });
        writeUrl(get().filters, colorBy);
      },

      async search(query) {
        const q = query.trim();
        const c = client;
        if (!q || !c || get().phase !== 'ready') return [];
        try {
          return await c.find(q, SEARCH_LIMIT);
        } catch {
          return [];
        }
      },

      setSearchResults(r) {
        set({ searchResults: r });
      },

      async exportGraph() {
        const c = client;
        if (!c || get().phase !== 'ready') return null;
        return c.exportGraph();
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
