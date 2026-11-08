import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { Analyzer, ignoredDirs, isIngestible, type FileInput } from '../pkg/core_wasm.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..', 'pkg');
const fixturesDir = join(here, '..', '..', '..', 'fixtures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function loadFixture(name: string): FileInput[] {
  const root = join(fixturesDir, name);
  return walk(root)
    .map((p) => ({ path: relative(root, p).split(sep).join('/'), abs: p }))
    .filter((f) => isIngestible(f.path))
    .map((f) => ({ path: f.path, content: readFileSync(f.abs, 'utf8') }));
}

beforeAll(async () => {
  const bytes = readFileSync(join(pkgDir, 'core_wasm_bg.wasm'));
  await init({ module_or_path: bytes });
});

describe('core-wasm boundary', () => {
  it('analisa o sample-project com campos camelCase', () => {
    const a = new Analyzer({ projectName: 'sample', maxFileBytes: 2_097_152 });
    a.addFiles(loadFixture('sample-project'));
    const s = a.finish();
    expect(s).toMatchObject({ files: 8, cycles: 1, externals: 2 }); // externos: react, date-fns
    expect(Object.keys(s)).toContain('parseErrors');
    const v = a.view(a.defaultExpansion());
    expect(v.nodes.filter((n) => n.kind !== 'external').every((n) => typeof n.parentId === 'number')).toBe(true);
    expect(a.issues().unresolved.map((u) => u.reason)).toEqual(['asset']);
    const lazy = a.find('lazy.ts', 1)[0];
    const d = a.detail(lazy.id)!;
    expect(d.kind).toBe('file');
    if (d.kind === 'file') expect(d.imports.map((i) => i.kind)).toEqual(['dynamic', 'dynamic']);
    expect(() => a.addFiles([])).toThrow('análise já finalizada');
    expect(a.detail(999_999)).toBeUndefined();
    a.free();
  });

  it('isIngestible segue as regras do core', () => {
    expect(isIngestible('src/a.ts')).toBe(true);
    expect(isIngestible('node_modules/x.js')).toBe(false);
    expect(ignoredDirs()).toContain('node_modules');
  });
});
