import { describe, expect, it } from 'vitest';
import type { Scene, SceneNode } from '../../src/export/scene';
import { buildSvg, SVG_MAX, SVG_PAD } from '../../src/export/svg';
import type { GraphTheme } from '../../src/renderer/theme';

const theme: GraphTheme = {
  paper: 'rgb(250, 250, 250)',
  paper2: 'rgb(240, 240, 240)',
  ink: 'rgb(10, 10, 10)',
  ink2: 'rgb(40, 40, 40)',
  muted: 'rgb(120, 120, 120)',
  rule: 'rgb(200, 200, 200)',
  rule2: 'rgb(170, 170, 170)',
  accent: 'rgb(0, 80, 200)',
  accentWash: 'rgb(230, 240, 255)',
  error: 'rgb(200, 30, 30)',
  labelFont: 'IBM Plex Sans',
  heat: ['rgb(1, 1, 1)', 'rgb(2, 2, 2)', 'rgb(3, 3, 3)', 'rgb(4, 4, 4)', 'rgb(5, 5, 5)'],
  unused: 'rgb(193, 122, 0)',
  testOnly: 'rgb(222, 161, 67)',
};

const n = (x: number, y: number, o: Partial<SceneNode> = {}): SceneNode => ({
  x,
  y,
  size: 5,
  color: theme.ink2,
  label: '',
  kind: 'file',
  ...o,
});

const attr = (svg: string, tag: string, name: string) =>
  [...svg.matchAll(new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`, 'g'))].map((m) => Number(m[1]));

describe('buildSvg', () => {
  it('enquadra todos os nós dentro da margem', () => {
    const svg = buildSvg({ nodes: [n(0, 0), n(10, 10)], edges: [] }, theme);
    expect(svg).toMatch(/^<svg[^>]*width="1600"/);
    for (const v of [...attr(svg, 'circle', 'cx'), ...attr(svg, 'circle', 'cy')]) {
      expect(v).toBeGreaterThanOrEqual(SVG_PAD);
      expect(v).toBeLessThanOrEqual(SVG_MAX - SVG_PAD);
    }
  });

  it('inverte o eixo y: y maior fica mais acima', () => {
    const svg = buildSvg({ nodes: [n(0, 0), n(0, 10)], edges: [] }, theme);
    const [low, high] = attr(svg, 'circle', 'cy');
    expect(high).toBeLessThan(low!);
  });

  it('um nó só, ou todos no mesmo lugar, fica no centro sem NaN', () => {
    for (const scene of [
      { nodes: [n(3, 3)], edges: [] },
      { nodes: [n(3, 3), n(3, 3)], edges: [] },
    ] satisfies Scene[]) {
      const svg = buildSvg(scene, theme);
      expect(svg).not.toContain('NaN');
      const width = Number(/width="(\d+)"/.exec(svg)![1]);
      const height = Number(/height="(\d+)"/.exec(svg)![1]);
      expect(attr(svg, 'circle', 'cx')[0]).toBeCloseTo(width / 2);
      expect(attr(svg, 'circle', 'cy')[0]).toBeCloseTo(height / 2);
    }
  });

  it('rótulo do nó mais à direita cabe na imagem', () => {
    const label = 'vite.config.ts.with-a-long-name';
    const svg = buildSvg({ nodes: [n(0, 0), n(10, 0, { label })], edges: [] }, theme);
    const width = Number(/width="(\d+)"/.exec(svg)![1]);
    const textX = attr(svg, 'text', 'x')[0]!;
    // Estimativa conservadora da largura do texto: 0,6 em por caractere.
    expect(textX + label.length * 12 * 0.6).toBeLessThanOrEqual(width);
  });

  it('a seta tem tamanho fixo, independente da espessura da aresta', () => {
    const svg = buildSvg(
      { nodes: [n(0, 0), n(10, 0)], edges: [{ source: 0, target: 1, size: 6, color: theme.rule2 }] },
      theme,
    );
    expect(svg).toMatch(/<marker[^>]*markerUnits="userSpaceOnUse"/);
  });

  it('desenha a legenda do heatmap quando recebe uma', () => {
    const legend = { title: 'Lines', items: [{ color: 'rgb(9, 9, 9)', label: '1–3' }, { color: 'rgb(8, 8, 8)', label: '4–9' }] };
    const svg = buildSvg({ nodes: [n(0, 0), n(10, 10)], edges: [] }, theme, legend);
    expect(svg).toContain('>Lines</text>');
    expect(svg).toContain('>1–3</text>');
    expect(svg).toContain('fill="rgb(9, 9, 9)"');
    expect(svg).toContain('fill="rgb(8, 8, 8)"');
  });

  it('escapa XML nos rótulos', () => {
    const svg = buildSvg({ nodes: [n(0, 0, { label: `a&b<"c>` })], edges: [] }, theme);
    expect(svg).toContain('a&amp;b&lt;&quot;c&gt;');
  });

  it('arestas têm seta e nós com borda ganham stroke', () => {
    const svg = buildSvg(
      {
        nodes: [n(0, 0), n(10, 0, { kind: 'group', borderColor: theme.rule2 })],
        edges: [{ source: 0, target: 1, size: 1, color: theme.rule2 }],
      },
      theme,
    );
    expect(svg).toContain('<marker');
    expect(svg).toMatch(/<line[^>]*marker-end="url\(#/);
    expect(svg).toMatch(/<circle[^>]*stroke="rgb\(170, 170, 170\)"/);
    expect(svg).toContain(`fill="${theme.paper}"`);
  });
});
