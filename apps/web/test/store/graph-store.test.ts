import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddResult, Detail, FileInput, SearchHit, VNode, VisibleGraph } from '@archviewer/core-wasm';
import type { AnalysisApi, FinishResult } from '../../src/analysis/client';
import { memorySource } from '../../src/ingest/source';
import { createGraphStore, type Phase } from '../../src/store/graph-store';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const node = (id: number, o: Partial<VNode> = {}): VNode => ({
  id,
  kind: 'file',
  label: `n${id}`,
  path: `n${id}`,
  size: 1,
  parentId: 0,
  inCycle: false,
  expandable: false,
  expanded: false,
  ...o,
});

// 0 raiz; 5 e 7 grupos; 9 arquivo dentro de 5.
function graphFor(expanded: number[]): VisibleGraph {
  const has = (id: number) => expanded.includes(id);
  const nodes: VNode[] = [
    node(0, { kind: 'group', expandable: true, expanded: true, parentId: undefined }),
    node(5, { kind: 'group', expandable: true, expanded: has(5) }),
    node(7, { kind: 'group', expandable: true, expanded: has(7) }),
  ];
  if (has(5)) nodes.push(node(9, { parentId: 5 }));
  return { nodes, edges: [] };
}

const finishResult = (defaultExpansion: number[]): FinishResult => ({
  summary: {} as FinishResult['summary'],
  issues: { unresolved: [], skipped: [], parseErrors: [], warnings: [] },
  defaultExpansion,
});

function makeApi(defaultExpansion: number[] = [0]) {
  let crashCb: ((m: string) => void) | null = null;
  const api = {
    ignoredDirs: vi.fn(async () => ['node_modules']),
    start: vi.fn(async () => {}),
    filterIngestible: vi.fn(async (paths: string[]) => paths.map(() => true)),
    addFiles: vi.fn(async (b: FileInput[]): Promise<AddResult> => ({ accepted: b.length, skipped: 0 })),
    finish: vi.fn(async () => finishResult(defaultExpansion)),
    view: vi.fn(async (e: number[]) => graphFor(e)),
    detail: vi.fn(async (id: number): Promise<Detail | null> => ({ kind: 'group', id }) as unknown as Detail),
    find: vi.fn(async () => [] as SearchHit[]),
    onCrash: vi.fn((cb: (m: string) => void) => {
      crashCb = cb;
      return () => {
        crashCb = null;
      };
    }),
    dispose: vi.fn(),
    crash: (m: string) => crashCb?.(m),
  };
  return api;
}
type FakeApi = ReturnType<typeof makeApi>;

const three = () => memorySource('proj', { 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' });
const asApi = (a: FakeApi) => a as unknown as AnalysisApi;

async function ready(api: FakeApi = makeApi([0])) {
  const store = createGraphStore({ api: () => asApi(api) });
  await store.getState().openProject(three(), false);
  return { api, store };
}

function big(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < 10_001; i++) files[`f${i}.ts`] = 'x';
  return files;
}

describe('openProject', () => {
  it('passa por scanning, reading, analyzing e ready', async () => {
    const api = makeApi([0, 5]);
    const store = createGraphStore({
      api: () => asApi(api),
      now: vi.fn().mockReturnValueOnce(100).mockReturnValue(350),
    });
    const phases: Phase[] = [];
    store.subscribe((s) => {
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    });
    await store.getState().openProject(three(), true);
    expect(phases).toEqual(['scanning', 'reading', 'analyzing', 'ready']);
    const s = store.getState();
    expect(s.projectName).toBe('proj');
    expect(s.fallback).toBe(true);
    expect(api.start).toHaveBeenCalledWith('proj');
    expect(api.view).toHaveBeenCalledWith([0, 5]);
    expect(s.graph).toEqual(graphFor([0, 5]));
    expect(s.expanded).toEqual([0, 5]);
    expect(s.elapsedMs).toBe(250);
    expect(s.summary).not.toBeNull();
    expect(s.issues).not.toBeNull();
    expect(api.addFiles).toHaveBeenCalledTimes(1);
  });

  it('nome vazio vira projeto', async () => {
    const api = makeApi();
    const store = createGraphStore({ api: () => asApi(api) });
    await store.getState().openProject(memorySource('', { 'a.ts': 'a' }), false);
    expect(store.getState().projectName).toBe('projeto');
  });

  it('acima de 10_000 arquivos pede confirmação; false volta a empty', async () => {
    const api = makeApi();
    const store = createGraphStore({ api: () => asApi(api) });
    const p = store.getState().openProject(memorySource('big', big()), false);
    await vi.waitFor(() => expect(store.getState().phase).toBe('confirm'));
    expect(store.getState().pendingCount).toBe(10_001);
    store.getState().confirmLarge(false);
    await p;
    expect(store.getState().phase).toBe('empty');
    expect(api.addFiles).not.toHaveBeenCalled();
    expect(api.dispose).toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
  });

  it('confirmLarge(true) segue para a leitura', async () => {
    const api = makeApi();
    const store = createGraphStore({ api: () => asApi(api) });
    const p = store.getState().openProject(memorySource('big', big()), false);
    await vi.waitFor(() => expect(store.getState().phase).toBe('confirm'));
    store.getState().confirmLarge(true);
    await p;
    expect(store.getState().phase).toBe('ready');
    expect(api.addFiles).toHaveBeenCalled();
  });

  it('cancel durante reading leva a empty, chama dispose e não deixa erro', async () => {
    const api = makeApi();
    const gate = deferred<AddResult>();
    api.addFiles.mockImplementation(() => gate.promise);
    const store = createGraphStore({ api: () => asApi(api) });
    const p = store.getState().openProject(three(), false);
    await vi.waitFor(() => expect(api.addFiles).toHaveBeenCalled());
    expect(store.getState().phase).toBe('reading');
    store.getState().cancel();
    gate.resolve({ accepted: 3, skipped: 0 });
    await p;
    const s = store.getState();
    expect(s.phase).toBe('empty');
    expect(s.error).toBeNull();
    expect(api.dispose).toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it('onCrash durante analyzing leva a error', async () => {
    const api = makeApi();
    const gate = deferred<FinishResult>();
    api.finish.mockImplementation(() => gate.promise);
    const store = createGraphStore({ api: () => asApi(api) });
    const p = store.getState().openProject(three(), false);
    await vi.waitFor(() => expect(store.getState().phase).toBe('analyzing'));
    api.crash('boom');
    expect(store.getState().phase).toBe('error');
    expect(store.getState().error).toBe('boom');
    gate.resolve(finishResult([0]));
    await p;
    expect(store.getState().phase).toBe('error');
    expect(api.dispose).toHaveBeenCalled();
  });

  it('exceção comum leva a error com a mensagem', async () => {
    const api = makeApi();
    api.ignoredDirs.mockRejectedValue(new Error('falhou'));
    const store = createGraphStore({ api: () => asApi(api) });
    await store.getState().openProject(three(), false);
    expect(store.getState().phase).toBe('error');
    expect(store.getState().error).toBe('falhou');
  });

  it('um novo openProject descarta o anterior e ignora sua resposta', async () => {
    const a1 = makeApi();
    const a2 = makeApi();
    const gate = deferred<FinishResult>();
    a1.finish.mockImplementation(() => gate.promise);
    const apis = [a1, a2];
    const store = createGraphStore({ api: () => asApi(apis.shift()!) });
    const p1 = store.getState().openProject(memorySource('um', { 'a.ts': 'a' }), false);
    await vi.waitFor(() => expect(store.getState().phase).toBe('analyzing'));
    await store.getState().openProject(memorySource('dois', { 'b.ts': 'b' }), false);
    expect(a1.dispose).toHaveBeenCalled();
    gate.resolve(finishResult([0]));
    await p1;
    expect(store.getState().projectName).toBe('dois');
    expect(store.getState().phase).toBe('ready');
  });

  it('reset volta ao inicial mantendo filtros', async () => {
    const { store } = await ready();
    store.getState().setFilter('cyclesOnly', true);
    store.getState().reset();
    const s = store.getState();
    expect(s.phase).toBe('empty');
    expect(s.graph).toEqual({ nodes: [], edges: [] });
    expect(s.filters.cyclesOnly).toBe(true);
  });
});

describe('toggle', () => {
  it('expande e recolhe', async () => {
    const { api, store } = await ready();
    await store.getState().toggle(5);
    expect(api.view).toHaveBeenLastCalledWith([0, 5]);
    expect(store.getState().expanded).toEqual([0, 5]);
    expect(store.getState().graph.nodes.some((n) => n.id === 9)).toBe(true);
    await store.getState().toggle(5);
    expect(api.view).toHaveBeenLastCalledWith([0]);
    expect(store.getState().expanded).toEqual([0]);
  });

  it('ignora nó não expansível', async () => {
    const { api, store } = await ready();
    const calls = api.view.mock.calls.length;
    await store.getState().toggle(123);
    expect(api.view.mock.calls.length).toBe(calls);
  });

  it('corrida: a resposta mais antiga chegando por último é descartada', async () => {
    const { api, store } = await ready();
    const g1 = deferred<VisibleGraph>();
    const g2 = deferred<VisibleGraph>();
    api.view.mockImplementationOnce(() => g1.promise).mockImplementationOnce(() => g2.promise);
    const t1 = store.getState().toggle(5);
    const t2 = store.getState().toggle(7);
    expect(api.view).toHaveBeenLastCalledWith([0, 5, 7]);
    g2.resolve(graphFor([0, 5, 7]));
    await t2;
    g1.resolve(graphFor([0, 5]));
    await t1;
    expect(store.getState().graph).toEqual(graphFor([0, 5, 7]));
    expect(store.getState().expanded).toEqual([0, 5, 7]);
  });

  it('recolher move a seleção para o grupo recolhido', async () => {
    const { api, store } = await ready(makeApi([0, 5]));
    await store.getState().select(9);
    expect(store.getState().selected).toBe(9);
    await store.getState().toggle(5);
    expect(store.getState().selected).toBe(5);
    expect(api.detail).toHaveBeenLastCalledWith(5);
    expect(store.getState().detail).toMatchObject({ id: 5 });
  });
});

describe('toggle com recolhimento superado', () => {
  it('o recolhimento descartado ainda move a seleção para o grupo', async () => {
    const { api, store } = await ready(makeApi([0, 5]));
    await store.getState().select(9);
    const g1 = deferred<VisibleGraph>();
    const g2 = deferred<VisibleGraph>();
    api.view.mockImplementationOnce(() => g1.promise).mockImplementationOnce(() => g2.promise);
    const collapse = store.getState().toggle(5);
    const expand = store.getState().toggle(7);
    g2.resolve(graphFor([0, 7]));
    await expand;
    g1.resolve(graphFor([0]));
    await collapse;
    expect(store.getState().graph).toEqual(graphFor([0, 7]));
    expect(store.getState().selected).toBe(5);
    expect(api.detail).toHaveBeenLastCalledWith(5);
    expect(store.getState().detail).toMatchObject({ id: 5 });
  });
});

describe('select', () => {
  it('carrega o detail e select(null) limpa', async () => {
    const { store } = await ready();
    await store.getState().select(5);
    expect(store.getState().selected).toBe(5);
    expect(store.getState().detail).toMatchObject({ id: 5 });
    await store.getState().select(null);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().detail).toBeNull();
  });

  it('detail antigo chegando depois é descartado', async () => {
    const { api, store } = await ready();
    const d1 = deferred<Detail | null>();
    api.detail.mockImplementationOnce(() => d1.promise);
    const s1 = store.getState().select(5);
    const s2 = store.getState().select(7);
    await s2;
    d1.resolve({ kind: 'group', id: 5 } as unknown as Detail);
    await s1;
    expect(store.getState().selected).toBe(7);
    expect(store.getState().detail).toMatchObject({ id: 7 });
  });

  it('detail null vira null', async () => {
    const { api, store } = await ready();
    api.detail.mockResolvedValueOnce(null);
    await store.getState().select(5);
    expect(store.getState().detail).toBeNull();
  });
});

describe('reveal', () => {
  it('expande ancestors, seleciona e pede foco', async () => {
    const { api, store } = await ready();
    const hit: SearchHit = { id: 9, kind: 'file', label: 'n9', path: 'n9', ancestors: [0, 5, 7] };
    await store.getState().reveal(hit);
    const s = store.getState();
    expect(s.expanded).toEqual([0, 5, 7]);
    expect(api.view).toHaveBeenLastCalledWith([0, 5, 7]);
    expect(s.selected).toBe(9);
    expect(s.focusRequest).toEqual({ id: 9, seq: 1 });
    await store.getState().reveal(hit);
    expect(store.getState().focusRequest).toEqual({ id: 9, seq: 2 });
  });
});

describe('setFilter', () => {
  it('atualiza o filtro e a URL', async () => {
    const { store } = await ready();
    store.getState().setFilter('hideExternals', true);
    expect(store.getState().filters.hideExternals).toBe(true);
    expect(window.location.search).toBe('?hide=externals');
    store.getState().setFilter('hideExternals', false);
    expect(window.location.search).toBe('');
  });
});

describe('search', () => {
  const hit: SearchHit = { id: 9, kind: 'file', label: 'n9', path: 'n9', ancestors: [0, 5] };

  it('devolve [] sem projeto aberto e não chama find', async () => {
    const api = makeApi();
    const store = createGraphStore({ api: () => asApi(api) });
    expect(await store.getState().search('n9')).toEqual([]);
    expect(api.find).not.toHaveBeenCalled();
  });

  it('em ready, chama find do cliente atual com a busca aparada', async () => {
    const api = makeApi();
    api.find.mockResolvedValue([hit]);
    const { store } = await ready(api);
    expect(await store.getState().search('  n9 ')).toEqual([hit]);
    expect(api.find).toHaveBeenCalledWith('n9', 50);
  });

  it('busca vazia devolve [] sem chamar find', async () => {
    const { api, store } = await ready();
    expect(await store.getState().search('   ')).toEqual([]);
    expect(api.find).not.toHaveBeenCalled();
  });

  it('falha do find devolve []', async () => {
    const api = makeApi();
    api.find.mockRejectedValue(new Error('boom'));
    const { store } = await ready(api);
    expect(await store.getState().search('n9')).toEqual([]);
  });

  it('setSearchResults guarda os resultados e reset limpa', async () => {
    const { store } = await ready();
    store.getState().setSearchResults({ query: 'n9', hits: [hit] });
    expect(store.getState().searchResults).toEqual({ query: 'n9', hits: [hit] });
    store.getState().reset();
    expect(store.getState().searchResults).toBeNull();
  });
});
