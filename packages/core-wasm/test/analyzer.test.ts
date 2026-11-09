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
    const root = v.nodes.find((n) => n.id === 0)!;
    expect(root).toMatchObject({ kind: 'group', label: 'sample', path: '', expanded: true });
    expect(root.parentId ?? null).toBeNull();
    const ids = new Set(v.nodes.map((n) => n.id));
    const nonRoot = v.nodes.filter((n) => n.kind !== 'external' && n.id !== 0);
    expect(nonRoot.length).toBeGreaterThan(0);
    expect(nonRoot.every((n) => typeof n.parentId === 'number' && ids.has(n.parentId))).toBe(true);
    expect(a.issues().unresolved.map((u) => u.reason)).toEqual(['asset']);
    const lazy = a.find('lazy.ts', 1)[0];
    const d = a.detail(lazy.id)!;
    expect(d.kind).toBe('file');
    if (d.kind === 'file') expect(d.imports.map((i) => i.kind)).toEqual(['dynamic', 'dynamic']);
    expect(() => a.addFiles([])).toThrow('analysis already finished');
    expect(a.detail(999_999)).toBeUndefined();
    a.free();
  });

  it('resolve projeto Vite com references (paths do projeto referenciado)', () => {
    const a = new Analyzer({ projectName: 'vite', maxFileBytes: 2_097_152 });
    a.addFiles([
      {
        path: 'tsconfig.json',
        content: '{"files":[],"references":[{"path":"./tsconfig.node.json"},{"path":"./tsconfig.app.json"}]}',
      },
      { path: 'tsconfig.node.json', content: '{"extends":"@tsconfig/node22/tsconfig.json","include":["vite.config.ts"]}' },
      {
        path: 'tsconfig.app.json',
        content:
          '{"extends":"@vue/tsconfig/tsconfig.dom.json","include":["src/**/*"],"compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
      },
      { path: 'src/a.ts', content: "import './b'; import '@/c';" },
      { path: 'src/b.ts', content: '' },
      { path: 'src/c.ts', content: '' },
    ]);
    const s = a.finish();
    expect(s).toMatchObject({ edges: 2, unresolved: 0, warnings: [] });
    a.free();
  });

  it('exportGraph: undefined antes de finish, grafo completo em camelCase depois', () => {
    const a = new Analyzer({ projectName: 'sample', maxFileBytes: 2_097_152 });
    a.addFiles(loadFixture('sample-project'));
    expect(a.exportGraph()).toBeUndefined();
    a.finish();
    const e = a.exportGraph()!;
    expect(e.files).toHaveLength(8);
    expect(e.files[0]).toHaveProperty('inCycle');
    expect(e.cycles).toEqual([['src/circular/a.ts', 'src/circular/b.ts']]);
    a.free();
  });

  it('deadCode: undefined antes de finish, em camelCase depois', () => {
    const a = new Analyzer({ projectName: 'sample', maxFileBytes: 2_097_152 });
    a.addFiles(loadFixture('sample-project'));
    expect(a.deadCode()).toBeUndefined();
    a.finish();
    const d = a.deadCode()!;
    expect(d.fallback).toBe(true);
    expect(d.unusedFiles).toContain('src/index.ts');
    expect(Object.keys(d)).toEqual(['entries', 'unusedFiles', 'testOnlyFiles', 'unusedExports', 'fallback']);
    a.free();
  });

  it('avisos chegam estruturados como { code, subject }', () => {
    const a = new Analyzer({ projectName: 'broken', maxFileBytes: 2_097_152 });
    a.addFiles([
      { path: 'tsconfig.json', content: '{ nope' },
      { path: 'src/a.ts', content: '' },
    ]);
    const s = a.finish();
    const expected = [{ code: 'invalidTsconfig', subject: 'tsconfig.json' }];
    expect(s.warnings).toEqual(expected);
    expect(a.issues().warnings).toEqual(expected);
    a.free();
  });

  it('isIngestible segue as regras do core', () => {
    expect(isIngestible('src/a.ts')).toBe(true);
    expect(isIngestible('./src/a.ts')).toBe(true);
    expect(isIngestible('src\\a.ts')).toBe(true);
    expect(isIngestible('node_modules/x.js')).toBe(false);
    expect(ignoredDirs()).toContain('node_modules');
  });
});
