import { describe, expect, it, vi } from 'vitest';
import type { AddResult, FileInput } from '@archviewer/core-wasm';
import { memorySource } from '../../src/ingest/source';
import type { ScanFile } from '../../src/ingest/scan';
import { readInto, type ReadProgress } from '../../src/ingest/read';

function many(n: number, content = 'x'): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < n; i++) o[`f${String(i).padStart(4, '0')}.ts`] = content;
  return o;
}
const toScan = (rec: Record<string, string>): ScanFile[] =>
  Object.entries(rec).map(([path, c]) => ({ path, size: new TextEncoder().encode(c).length }));
const okAdd = () =>
  vi.fn(async (b: FileInput[]): Promise<AddResult> => ({ accepted: b.length, skipped: 0 }));
const base = { maxFileBytes: 1000, batchFiles: 200, batchBytes: 1_000_000 };

describe('readInto', () => {
  it('divide 450 arquivos em 200, 200 e 50', async () => {
    const rec = many(450);
    const add = okAdd();
    const r = await readInto(memorySource('m', rec), toScan(rec), add, base);
    expect(add.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(r).toEqual({ accepted: 450, skipped: [] });
  });

  it('batchBytes corta antes de 200', async () => {
    const rec = many(10, 'xxxx');
    const add = okAdd();
    await readInto(memorySource('m', rec), toScan(rec), add, { ...base, batchBytes: 12 });
    expect(add.mock.calls.map((c) => c[0].length)).toEqual([3, 3, 3, 1]);
  });

  it('arquivo maior que batchBytes mas dentro do limite vai sozinho', async () => {
    const rec = { 'a.ts': 'x', 'b.ts': 'x'.repeat(50), 'c.ts': 'x' };
    const add = okAdd();
    await readInto(memorySource('m', rec), toScan(rec), add, { ...base, batchBytes: 10 });
    expect(add.mock.calls.map((c) => c[0].map((f) => f.path))).toEqual([
      ['a.ts'],
      ['b.ts'],
      ['c.ts'],
    ]);
  });

  it('arquivo acima de maxFileBytes vira tooLarge sem ser lido', async () => {
    const rec = { 'big.ts': 'x'.repeat(50), 'ok.ts': 'x' };
    const src = memorySource('m', rec);
    const read = vi.spyOn(src, 'read');
    const r = await readInto(src, toScan(rec), okAdd(), { ...base, maxFileBytes: 10 });
    expect(r.skipped).toEqual([{ path: 'big.ts', reason: 'tooLarge' }]);
    expect(read).not.toHaveBeenCalledWith('big.ts');
    expect(r.accepted).toBe(1);
  });

  it('read que lança vira unreadable', async () => {
    const rec = { 'a.ts': 'x', 'b.ts': 'x' };
    const src = memorySource('m', rec);
    const orig = src.read.bind(src);
    src.read = async (p) => {
      if (p === 'a.ts') throw new Error('boom');
      return orig(p);
    };
    const r = await readInto(src, toScan(rec), okAdd(), base);
    expect(r.skipped).toEqual([{ path: 'a.ts', reason: 'unreadable' }]);
    expect(r.accepted).toBe(1);
  });

  it('onProgress termina em { read: total, total }', async () => {
    const rec = { ...many(5), 'big.ts': 'x'.repeat(50) };
    const seen: ReadProgress[] = [];
    await readInto(memorySource('m', rec), toScan(rec), okAdd(), {
      ...base,
      maxFileBytes: 10,
      onProgress: (p) => seen.push(p),
    });
    expect(seen.at(-1)).toEqual({ read: 6, total: 6 });
  });

  it('abortar depois do primeiro lote não gera novos addFiles', async () => {
    const rec = many(450);
    const ac = new AbortController();
    const add = vi.fn(async (b: FileInput[]): Promise<AddResult> => {
      ac.abort();
      return { accepted: b.length, skipped: 0 };
    });
    await expect(
      readInto(memorySource('m', rec), toScan(rec), add, { ...base, signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(add).toHaveBeenCalledTimes(1);
  });
});
