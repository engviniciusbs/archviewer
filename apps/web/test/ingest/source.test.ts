import { describe, expect, it } from 'vitest';
import { fromFileList, memorySource } from '../../src/ingest/source';

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
