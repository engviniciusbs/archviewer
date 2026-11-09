import type { VNode } from '@archviewer/core-wasm';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../../src/i18n/locales';
import { changesPainter, heatColorIndex, heatLegend, heatScale, metricOf } from '../../src/renderer/heat';
import { diffGraphs } from '../../src/compare/diff';
import { g } from '../compare/helpers';

const node = (id: number, o: Partial<VNode> = {}): VNode => ({
  id,
  kind: 'file',
  label: `f${id}`,
  path: `f${id}`,
  size: 1,
  parentId: 0,
  inCycle: false,
  expandable: false,
  expanded: false,
  metrics: { fanIn: 0, fanOut: 0, loc: 0, unused: 0 },
  ...o,
});

const colors = { heat: ['h1', 'h2', 'h3', 'h4', 'h5'], unused: 'u', testOnly: 't', added: 'A', changed: 'C' };

describe('heatScale', () => {
  it('cinco faixas por quantis', () => {
    const s = heatScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.bands).toEqual([
      { min: 1, max: 2 },
      { min: 3, max: 4 },
      { min: 5, max: 6 },
      { min: 7, max: 8 },
      { min: 9, max: 10 },
    ]);
    expect(s.band(1)).toBe(0);
    expect(s.band(10)).toBe(4);
  });

  it('valores iguais viram uma faixa só', () => {
    const s = heatScale([4, 4, 4]);
    expect(s.bands).toEqual([{ min: 4, max: 4 }]);
    expect(s.band(4)).toBe(0);
  });

  it('zero cai na faixa mais clara', () => {
    const s = heatScale([0, 0, 5]);
    expect(s.band(0)).toBe(0);
    expect(s.bands).toEqual([
      { min: 0, max: 0 },
      { min: 1, max: 5 },
    ]);
  });

  it('sem valores, sem faixas', () => {
    const s = heatScale([]);
    expect(s.bands).toEqual([]);
    expect(s.band(3)).toBe(0);
  });
});

describe('heatColorIndex', () => {
  it('espalha poucas faixas pela rampa inteira', () => {
    expect([0, 1, 2, 3, 4].map((b) => heatColorIndex(b, 5))).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1].map((b) => heatColorIndex(b, 2))).toEqual([0, 4]);
    expect(heatColorIndex(0, 1)).toBe(2);
  });
});

describe('metricOf', () => {
  it('externos só têm valor no fan-in', () => {
    const ext = node(9, { kind: 'external', metrics: { fanIn: 3, fanOut: 0, loc: 0, unused: 0 } });
    expect(metricOf(ext, 'fanIn')).toBe(3);
    expect(metricOf(ext, 'loc')).toBeNull();
    expect(metricOf(ext, 'fanOut')).toBeNull();
    expect(metricOf(node(1, { metrics: { fanIn: 1, fanOut: 2, loc: 30, unused: 0 } }), 'loc')).toBe(30);
  });
});

describe('heatLegend', () => {
  const t = messagesFor('en');
  it('rótulos por faixa com o título da métrica', () => {
    const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      node(v, { metrics: { fanIn: 0, fanOut: 0, loc: v, unused: 0 } }),
    );
    expect(heatLegend('loc', nodes, t, colors)).toEqual({
      title: 'Lines',
      items: [
        { color: 'h1', label: '1–2' },
        { color: 'h2', label: '3–4' },
        { color: 'h3', label: '5–6' },
        { color: 'h4', label: '7–8' },
        { color: 'h5', label: '9–10' },
      ],
    });
  });

  it('uma faixa só mostra o valor único', () => {
    const nodes = [node(1, { metrics: { fanIn: 4, fanOut: 0, loc: 0, unused: 0 } })];
    expect(heatLegend('fanIn', nodes, t, colors)?.items).toEqual([{ color: 'h3', label: '4' }]);
  });

  it('modo unused tem duas amostras; none não tem legenda', () => {
    expect(heatLegend('unused', [], t, colors)).toEqual({
      title: 'Unused',
      items: [
        { color: 'u', label: 'Unused' },
        { color: 't', label: 'Used only by tests' },
      ],
    });
    expect(heatLegend('none', [], t, colors)).toBeNull();
  });

  it('modo changes: novo e dependências alteradas', () => {
    expect(heatLegend('changes', [], t, colors)).toEqual({
      title: 'Changes',
      items: [
        { color: 'A', label: 'Added' },
        { color: 'C', label: 'Changed dependencies' },
      ],
    });
  });
});

describe('changesPainter', () => {
  const diff = diffGraphs(
    g({ files: ['src/a.ts', 'src/lib/b.ts'], externals: [] }),
    g({
      files: ['src/a.ts', 'src/lib/b.ts', 'src/new.ts'],
      externals: ['react'],
      edges: [['src/lib/b.ts', 'react']],
    }),
  );
  const paint = changesPainter(diff, colors);
  it('pinta o que é novo e o que teve dependências alteradas', () => {
    expect(paint(node(1, { path: 'src/new.ts' }))).toEqual({ color: 'A' });
    expect(paint(node(2, { path: 'src/lib/b.ts' }))).toEqual({ color: 'C' });
    expect(paint(node(3, { path: 'src/a.ts' }))).toBeUndefined();
    expect(paint(node(4, { kind: 'external', path: 'react', label: 'react' }))).toEqual({ color: 'A' });
  });
  it('grupo com mudança dentro ganha borda', () => {
    expect(paint(node(5, { kind: 'group', path: 'src/lib' }))).toEqual({ borderColor: 'C' });
    expect(paint(node(6, { kind: 'group', path: 'src' }))).toEqual({ borderColor: 'C' });
    expect(paint(node(7, { kind: 'group', path: 'docs' }))).toBeUndefined();
    expect(paint(node(8, { kind: 'group', path: '' }))).toBeUndefined();
  });
});
