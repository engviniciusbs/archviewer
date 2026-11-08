// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import init, * as core from '@archviewer/core-wasm';
import type { FileInput, Summary } from '@archviewer/core-wasm';
import { createHandler } from '../../src/analysis/handler';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const pkgDir = join(root, 'packages', 'core-wasm', 'pkg');
const sample = join(root, 'fixtures', 'sample-project');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function loadSample(): FileInput[] {
  return walk(sample)
    .map((p) => ({ path: relative(sample, p).split(sep).join('/'), abs: p }))
    .filter((f) => core.isIngestible(f.path))
    .map((f) => ({ path: f.path, content: readFileSync(f.abs, 'utf8') }));
}

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(pkgDir, 'core_wasm_bg.wasm')) });
});

describe('createHandler', () => {
  it('start + addFiles + finish devolve resumo, issues e expansão padrão', () => {
    const h = createHandler(core);
    h('start', ['sample']);
    h('addFiles', [loadSample()]);
    const r = h('finish', []) as { summary: Summary; issues: unknown; defaultExpansion: number[] };
    expect(r.summary).toMatchObject({ files: 8, cycles: 1, externals: 2 });
    expect(r.defaultExpansion).toContain(0);
    expect(r.issues).toBeDefined();
  });

  it('filterIngestible', () => {
    const h = createHandler(core);
    expect(h('filterIngestible', [['src/a.ts', 'README.md', 'node_modules/x.js']])).toEqual([true, false, false]);
  });

  it('ignoredDirs devolve a lista do core', () => {
    const h = createHandler(core);
    expect(h('ignoredDirs', [])).toContain('node_modules');
  });

  it('detail de id desconhecido dá null', () => {
    const h = createHandler(core);
    h('start', ['sample']);
    h('addFiles', [loadSample()]);
    h('finish', []);
    expect(h('detail', [999_999])).toBeNull();
  });

  it('método antes de start lança sessão não iniciada', () => {
    const h = createHandler(core);
    expect(() => h('view', [[0]])).toThrow('sessão não iniciada');
  });

  it('um segundo start zera a sessão', () => {
    const h = createHandler(core);
    h('start', ['sample']);
    h('addFiles', [loadSample()]);
    h('start', ['outro']);
    const r = h('finish', []) as { summary: Summary };
    expect(r.summary.files).toBe(0);
  });
});
