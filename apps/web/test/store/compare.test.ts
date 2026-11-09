import type { GraphExport } from '@archviewer/core-wasm';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisApi } from '../../src/analysis/client';
import { memorySource } from '../../src/ingest/source';
import { createGraphStore } from '../../src/store/graph-store';
import { g } from '../compare/helpers';
import { makeApi, type FakeApi } from '../components/helpers';

const current = { ...g({ files: ['src/a.ts', 'src/b.ts', 'src/new.ts'] }), project: 'proj' } as GraphExport;
const base = { ...g({ files: ['src/a.ts', 'src/b.ts'] }), project: 'proj' } as GraphExport;

/** Store cujo primeiro cliente é o do projeto e os seguintes vêm da fila (pasta de base). */
async function setup(extra: FakeApi[] = []) {
  const main = makeApi({ exportGraph: current });
  const queue = [main, ...extra];
  const store = createGraphStore({ api: () => (queue.shift() ?? makeApi()) as unknown as AnalysisApi, now: () => 0 });
  await store.getState().openProject(memorySource('proj', { 'src/a.ts': 'a' }), false);
  return { store, main };
}

describe('compareWithExport', () => {
  it('compara o projeto aberto com o JSON e guarda o rótulo', async () => {
    const { store } = await setup();
    expect(await store.getState().compareWithExport(JSON.stringify(base), 'main.json')).toBe(true);
    const c = store.getState().comparison!;
    expect(c.label).toBe('main.json');
    expect(c.diff.filesAdded).toEqual(['src/new.ts']);
    expect(c.warning).toBeNull();
  });

  it('o próprio export não tem mudanças', async () => {
    const { store } = await setup();
    await store.getState().compareWithExport(JSON.stringify(current), 'same.json');
    expect(store.getState().comparison!.diff.changeCount).toBe(0);
  });

  it('JSON inválido devolve false e marca erro', async () => {
    const { store } = await setup();
    expect(await store.getState().compareWithExport('{', 'x.json')).toBe(false);
    expect(store.getState().comparison).toBeNull();
    expect(store.getState().comparePhase).toEqual({ status: 'error', message: 'invalid' });
  });

  it('avisa quando o export é de outro projeto', async () => {
    const { store } = await setup();
    await store.getState().compareWithExport(JSON.stringify({ ...base, project: 'other' }), 'o.json');
    expect(store.getState().comparison!.warning).toBe('projectMismatch');
  });
});

describe('compareWithFolder', () => {
  it('analisa a pasta num cliente temporário e o descarta', async () => {
    const baseline = makeApi({ exportGraph: base });
    const { store } = await setup([baseline]);
    const phases: string[] = [];
    store.subscribe((s) => phases.push(s.comparePhase.status));
    await store.getState().compareWithFolder(memorySource('old', { 'src/a.ts': 'a', 'src/b.ts': 'b' }));
    expect(baseline.start).toHaveBeenCalledWith('old');
    expect(baseline.addFiles).toHaveBeenCalled();
    expect(baseline.dispose).toHaveBeenCalled();
    expect(phases).toContain('loading');
    const c = store.getState().comparison!;
    expect(c.label).toBe('old');
    expect(c.diff.filesAdded).toEqual(['src/new.ts']);
    expect(store.getState().comparePhase).toEqual({ status: 'idle' });
  });

  it('falha na base vira erro e descarta o cliente', async () => {
    const baseline = makeApi();
    baseline.finish.mockRejectedValueOnce(new Error('boom'));
    const { store } = await setup([baseline]);
    await store.getState().compareWithFolder(memorySource('old', { 'a.ts': 'a' }));
    expect(store.getState().comparePhase).toEqual({ status: 'error', message: 'boom' });
    expect(baseline.dispose).toHaveBeenCalled();
  });

  it('abrir outro projeto no meio descarta o resultado tardio', async () => {
    let release!: () => void;
    const baseline = makeApi({ exportGraph: base });
    baseline.finish.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(undefined as never))) as never,
    );
    const { store } = await setup([baseline, makeApi({ exportGraph: current })]);
    const p = store.getState().compareWithFolder(memorySource('old', { 'a.ts': 'a' }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await store.getState().openProject(memorySource('next', { 'x.ts': 'x' }), false);
    release();
    await p;
    expect(store.getState().comparison).toBeNull();
    expect(baseline.dispose).toHaveBeenCalled();
  });
});

describe('fim da comparação', () => {
  it('clearComparison limpa e devolve o modo changes para none', async () => {
    const { store } = await setup();
    await store.getState().compareWithExport(JSON.stringify(base), 'b.json');
    store.getState().setColorBy('changes');
    expect(store.getState().colorBy).toBe('changes');
    store.getState().clearComparison();
    expect(store.getState().comparison).toBeNull();
    expect(store.getState().colorBy).toBe('none');
  });

  it('changes sem comparação é ignorado', async () => {
    const { store } = await setup();
    store.getState().setColorBy('changes');
    expect(store.getState().colorBy).toBe('none');
  });

  it('abrir outro projeto limpa a comparação', async () => {
    const { store } = await setup([makeApi({ exportGraph: current })]);
    await store.getState().compareWithExport(JSON.stringify(base), 'b.json');
    await store.getState().openProject(memorySource('next', { 'x.ts': 'x' }), false);
    expect(store.getState().comparison).toBeNull();
  });
});
