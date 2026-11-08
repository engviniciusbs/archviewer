import { describe, expect, it } from 'vitest';
import { fromDirectoryHandle, fromFileList, memorySource } from '../../src/ingest/source';

function file(rel: string, content: string): File {
  const f = new File([content], rel.split('/').pop()!);
  Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
}

describe('fromFileList', () => {
  it('remove o primeiro segmento e lista diretórios', async () => {
    const src = fromFileList([file('meu-app/src/a.ts', 'abc'), file('meu-app/package.json', '{}')]);
    expect(src.name).toBe('meu-app');
    expect(await src.list('src')).toEqual([{ name: 'a.ts', kind: 'file', size: 3 }]);
    const root = await src.list('');
    expect(root).toEqual(
      expect.arrayContaining([
        { name: 'src', kind: 'dir', size: 0 },
        { name: 'package.json', kind: 'file', size: 2 },
      ]),
    );
    expect(await src.read('src/a.ts')).toBe('abc');
  });
});

describe('memorySource', () => {
  it('deriva diretórios e usa bytes UTF-8 como size', async () => {
    const src = memorySource('m', { 'pkg/a.ts': 'é' });
    expect(await src.list('')).toEqual([{ name: 'pkg', kind: 'dir', size: 0 }]);
    expect(await src.list('pkg')).toEqual([{ name: 'a.ts', kind: 'file', size: 2 }]);
    expect(await src.read('pkg/a.ts')).toBe('é');
  });
});

type FakeFile = { size: number; text?: string; fail?: boolean };
type FakeTree = { [name: string]: FakeFile | FakeTree };
const isFile = (v: FakeFile | FakeTree): v is FakeFile => typeof (v as FakeFile).size === 'number';

/** FileSystemDirectoryHandle mínimo; `getFile` de um arquivo com `fail` lança NotReadableError. */
function fakeHandle(name: string, tree: FakeTree, track = { inFlight: 0, max: 0 }): FileSystemDirectoryHandle {
  const fileHandle = (n: string, f: FakeFile) => ({
    kind: 'file' as const,
    name: n,
    async getFile() {
      track.inFlight++;
      track.max = Math.max(track.max, track.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      track.inFlight--;
      if (f.fail) throw new DOMException('travado', 'NotReadableError');
      return { size: f.size, text: async () => f.text ?? '' };
    },
  });
  const dir = (n: string, t: FakeTree): unknown => ({
    kind: 'directory' as const,
    name: n,
    async *entries() {
      for (const [k, v] of Object.entries(t)) yield [k, isFile(v) ? fileHandle(k, v) : dir(k, v)];
    },
    async getDirectoryHandle(k: string) {
      const v = t[k];
      if (!v || isFile(v)) throw new DOMException('não existe', 'NotFoundError');
      return dir(k, v);
    },
    async getFileHandle(k: string) {
      const v = t[k];
      if (!v || !isFile(v)) throw new DOMException('não existe', 'NotFoundError');
      return fileHandle(k, v);
    },
  });
  return dir(name, tree) as FileSystemDirectoryHandle;
}

describe('fromDirectoryHandle', () => {
  it('arquivo cujo getFile falha não derruba o list e falha na leitura', async () => {
    const src = fromDirectoryHandle(
      fakeHandle('p', { 'ok.ts': { size: 3, text: 'abc' }, 'locked.ts': { size: 9, fail: true }, src: {} }),
    );
    const entries = await src.list('');
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'ok.ts', kind: 'file', size: 3 },
        { name: 'locked.ts', kind: 'file', size: 0 },
        { name: 'src', kind: 'dir', size: 0 },
      ]),
    );
    await expect(src.read('locked.ts')).rejects.toThrow();
    expect(await src.read('ok.ts')).toBe('abc');
  });
});
