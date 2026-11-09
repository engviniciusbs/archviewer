import { describe, expect, it } from 'vitest';
import { diffGraphs, dirname } from '../../src/compare/diff';
import { g } from './helpers';

describe('diffGraphs', () => {
  it('versões idênticas não têm mudanças', () => {
    const a = g({ edges: [['src/a.ts', 'src/b.ts']] });
    const d = diffGraphs(a, a);
    expect(d.changeCount).toBe(0);
    expect(d.filesAdded).toEqual([]);
    expect(d.edgesAdded).toEqual([]);
    expect(d.summary).toEqual({ files: 0, edges: 0, cycles: 0, externals: 0, unused: 0 });
  });

  it('arquivos e pacotes adicionados e removidos', () => {
    const d = diffGraphs(
      g({ files: ['src/a.ts', 'src/old.ts'], externals: ['lodash'] }),
      g({ files: ['src/a.ts', 'src/new.ts'], externals: ['react'] }),
    );
    expect(d.filesAdded).toEqual(['src/new.ts']);
    expect(d.filesRemoved).toEqual(['src/old.ts']);
    expect(d.externalsAdded).toEqual(['react']);
    expect(d.externalsRemoved).toEqual(['lodash']);
    expect(d.changeCount).toBe(4);
  });

  it('dependências pelo par from → to, ignorando o tipo', () => {
    const d = diffGraphs(
      g({ externals: ['react'], edges: [['src/a.ts', 'src/b.ts', 'static'], ['src/b.ts', 'react']] }),
      g({ externals: ['react'], edges: [['src/a.ts', 'src/b.ts', 'typeOnly'], ['src/a.ts', 'react']] }),
    );
    expect(d.edgesAdded).toEqual([{ from: 'src/a.ts', to: 'react', external: true }]);
    expect(d.edgesRemoved).toEqual([{ from: 'src/b.ts', to: 'react', external: true }]);
  });

  it('ciclos novos e resolvidos, pelo conjunto de arquivos', () => {
    const d = diffGraphs(
      g({ cycles: [['src/a.ts', 'src/b.ts'], ['src/x.ts', 'src/y.ts']] }),
      g({ cycles: [['src/b.ts', 'src/a.ts'], ['src/p.ts', 'src/q.ts']] }),
    );
    expect(d.cyclesAdded).toEqual([['src/p.ts', 'src/q.ts']]);
    expect(d.cyclesResolved).toEqual([['src/x.ts', 'src/y.ts']]);
  });

  it('maiores variações de fan-in só entre arquivos dos dois lados', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'];
    const d = diffGraphs(
      g({ files, edges: [['src/b.ts', 'src/a.ts'], ['src/a.ts', 'src/f.ts']] }),
      g({
        files: [...files, 'src/n.ts'],
        edges: [
          ['src/b.ts', 'src/a.ts'],
          ['src/c.ts', 'src/a.ts'],
          ['src/d.ts', 'src/a.ts'],
          ['src/e.ts', 'src/a.ts'],
          ['src/a.ts', 'src/n.ts'],
        ],
      }),
    );
    expect(d.fanInChanges).toEqual([
      { path: 'src/a.ts', before: 1, after: 4 },
      { path: 'src/f.ts', before: 1, after: 0 },
    ]);
  });

  it('passaram a ficar sem uso; export antigo sem deadCode não quebra', () => {
    expect(diffGraphs(g({ unused: ['src/a.ts'] }), g({ unused: ['src/a.ts', 'src/b.ts'] })).newlyUnused).toEqual([
      'src/b.ts',
    ]);
    const d = diffGraphs(g({ unused: null }), g({ unused: ['src/b.ts'] }));
    expect(d.newlyUnused).toEqual(['src/b.ts']);
    expect(d.summary.unused).toBe(1);
  });

  it('a ordem da entrada não muda a saída', () => {
    const before = g({ files: ['src/b.ts', 'src/a.ts'], edges: [['src/b.ts', 'src/a.ts']] });
    const after = g({
      files: ['src/z.ts', 'src/a.ts', 'src/m.ts', 'src/b.ts'],
      edges: [
        ['src/z.ts', 'src/a.ts'],
        ['src/m.ts', 'src/a.ts'],
      ],
    });
    const shuffled = { ...after, files: [...after.files].reverse(), edges: [...after.edges].reverse() };
    expect(diffGraphs(before, shuffled)).toEqual(diffGraphs(before, after));
    expect(diffGraphs(before, after).filesAdded).toEqual(['src/m.ts', 'src/z.ts']);
  });

  it('deltas do resumo', () => {
    const d = diffGraphs(g({ files: ['a.ts'] }), g({ files: ['a.ts', 'b.ts', 'c.ts'] }));
    expect(d.summary.files).toBe(2);
  });
});

describe('dirname', () => {
  it('pasta do caminho, ou . na raiz', () => {
    expect(dirname('src/a/b.ts')).toBe('src/a');
    expect(dirname('b.ts')).toBe('.');
  });
});
