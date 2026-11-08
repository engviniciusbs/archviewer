import { describe, expect, it, vi } from 'vitest';
import { memorySource } from '../../src/ingest/source';
import { scan } from '../../src/ingest/scan';

const ignoredDirs = ['node_modules', 'dist'];

describe('scan', () => {
  it('pula pastas ignoradas, ocultas e retorna ordenado', async () => {
    const src = memorySource('p', {
      'node_modules/x.js': '1',
      'pkg/node_modules/y.js': '1',
      '.git/z.js': '1',
      '.cache/a.ts': '1',
      'src/b.ts': 'bb',
      'src/a.ts': 'a',
      'package.json': '{}',
    });
    const files = await scan(src, { ignoredDirs });
    expect(files).toEqual([
      { path: 'package.json', size: 2 },
      { path: 'src/a.ts', size: 1 },
      { path: 'src/b.ts', size: 2 },
    ]);
  });

  it('respeita .gitignore da raiz e aninhado', async () => {
    const src = memorySource('p', {
      '.gitignore': 'build\n*.log',
      'build/o.js': '1',
      'a.log': '1',
      'pkg/.gitignore': 'gen/\nlocal.ts',
      'pkg/gen/g.ts': '1',
      'pkg/local.ts': '1',
      'pkg/keep.ts': '1',
      'gen/ok.ts': '1',
    });
    const paths = (await scan(src, { ignoredDirs })).map((f) => f.path);
    expect(paths).toEqual(['.gitignore', 'gen/ok.ts', 'pkg/.gitignore', 'pkg/keep.ts']);
  });

  it('nunca lista pasta ignorada', async () => {
    const src = memorySource('p', {
      '.gitignore': 'out',
      'out/a.ts': '1',
      'node_modules/a.js': '1',
      'src/a.ts': '1',
    });
    const list = vi.spyOn(src, 'list');
    await scan(src, { ignoredDirs });
    const called = list.mock.calls.map((c) => c[0]);
    expect(called).toEqual(expect.arrayContaining(['', 'src']));
    expect(called).not.toContain('out');
    expect(called).not.toContain('node_modules');
  });

  it('aborta com AbortError', async () => {
    const src = memorySource('p', { 'a.ts': '1' });
    const ac = new AbortController();
    ac.abort();
    await expect(scan(src, { ignoredDirs, signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('pasta ilegível vira pulada e o resto segue', async () => {
    const src = memorySource('p', { 'locked/a.ts': '1', 'src/b.ts': '1' });
    const orig = src.list.bind(src);
    src.list = async (dir) => {
      if (dir === 'locked') throw new DOMException('negado', 'NotReadableError');
      return orig(dir);
    };
    const unreadable: string[] = [];
    const files = await scan(src, { ignoredDirs, onUnreadable: (p) => unreadable.push(p) });
    expect(files.map((f) => f.path)).toEqual(['src/b.ts']);
    expect(unreadable).toEqual(['locked']);
  });

  it('raiz ilegível ainda rejeita', async () => {
    const src = memorySource('p', { 'a.ts': '1' });
    src.list = async () => {
      throw new Error('negado');
    };
    await expect(scan(src, { ignoredDirs })).rejects.toThrow('negado');
  });
});
