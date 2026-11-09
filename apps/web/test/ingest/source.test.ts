import { describe, expect, it } from 'vitest';
import { fromDirectoryHandle, fromFileList, memorySource } from '../../src/ingest/source';
import { scan } from '../../src/ingest/scan';

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

  it('arquivo ausente rejeita com mensagem técnica em inglês', async () => {
    const src = fromFileList([file('proj/src/a.ts', 'abc')]);
    await expect(src.read('src/zz.ts')).rejects.toThrow('file not found: src/zz.ts');
    await expect(memorySource('p', {}).read('x.ts')).rejects.toThrow('file not found: x.ts');
  });
});

describe('fromFileList em escala', () => {
  /** Objetos com a forma de File; o fromFileList só lê nome, caminho relativo e tamanho. */
  const fake = (rel: string, size = 1) => ({ name: rel.split('/').pop()!, webkitRelativePath: rel, size }) as File;

  it('lista filhos diretos de pastas aninhadas', async () => {
    const src = fromFileList([fake('r/a/b/c.ts', 3), fake('r/a/d.ts', 2), fake('r/a/b/e/f.ts')]);
    expect(await src.list('a')).toEqual(
      expect.arrayContaining([
        { name: 'b', kind: 'dir', size: 0 },
        { name: 'd.ts', kind: 'file', size: 2 },
      ]),
    );
    expect(await src.list('a')).toHaveLength(2);
    expect(await src.list('a/b')).toEqual(
      expect.arrayContaining([
        { name: 'c.ts', kind: 'file', size: 3 },
        { name: 'e', kind: 'dir', size: 0 },
      ]),
    );
    expect(await src.list('nada')).toEqual([]);
  });

  it('varre 20 mil fontes ao lado de 200 mil entradas de node_modules rapidamente', async () => {
    const files: File[] = [];
    for (let i = 0; i < 200_000; i++) files.push(fake(`r/node_modules/p${i % 2000}/f${i}.js`));
    for (let i = 0; i < 20_000; i++) files.push(fake(`r/src/d${i % 1000}/f${i}.ts`));
    const src = fromFileList(files);
    const t0 = performance.now();
    const found = await scan(src, { ignoredDirs: ['node_modules'] });
    expect(found).toHaveLength(20_000);
    // Com o índice varrido a cada list(), isto levava ~5 s aqui; indexado, uma fração disso.
    expect(performance.now() - t0).toBeLessThan(1500);
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

  it('chama getFile em paralelo dentro de um diretório', async () => {
    const tree: FakeTree = {};
    for (let i = 0; i < 40; i++) tree[`f${i}.ts`] = { size: i };
    const track = { inFlight: 0, max: 0 };
    const entries = await fromDirectoryHandle(fakeHandle('p', tree, track)).list('');
    expect(entries).toHaveLength(40);
    expect(entries.find((e) => e.name === 'f7.ts')).toEqual({ name: 'f7.ts', kind: 'file', size: 7 });
    expect(track.max).toBeGreaterThan(1);
  });
});
