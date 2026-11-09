import type { GraphTheme } from '../renderer/theme';
import type { Scene } from './scene';

export const SVG_MAX = 1600;
export const SVG_PAD = 40;
const SVG_MIN = 320;
const LABEL_SIZE = 12;

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Fonte do app com fallback: o rasterizador do PNG não carrega webfonts. */
const fontStack = (theme: GraphTheme) => xml(`${theme.labelFont ? `${theme.labelFont}, ` : ''}system-ui, sans-serif`);

/**
 * SVG da cena inteira, independente do zoom: todos os nós cabem com margem `SVG_PAD`,
 * a maior dimensão vira `SVG_MAX` e o eixo y é invertido (no graphology y cresce para cima).
 */
export function buildSvg(scene: Scene, theme: GraphTheme): string {
  const xs = scene.nodes.map((n) => n.x);
  const ys = scene.nodes.map((n) => n.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const rx = maxX - minX;
  const ry = maxY - minY;
  const scale = (SVG_MAX - 2 * SVG_PAD) / (Math.max(rx, ry) || 1);
  const innerW = rx * scale;
  const innerH = ry * scale;
  const baseWidth = Math.max(innerW + 2 * SVG_PAD, SVG_MIN);
  const height = Math.round(Math.max(innerH + 2 * SVG_PAD, SVG_MIN));
  const offX = (baseWidth - innerW) / 2;
  const offY = (height - innerH) / 2;
  const px = (x: number) => offX + (x - minX) * scale;
  const py = (y: number) => offY + (maxY - y) * scale;
  // Rótulos saem à direita do nó: a imagem cresce para o mais comprido caber (estimativa de 0,6 em por caractere).
  const labelEnd = Math.max(
    0,
    ...scene.nodes.filter((n) => n.label).map((n) => px(n.x) + n.size + 4 + n.label.length * LABEL_SIZE * 0.6),
  );
  const width = Math.ceil(Math.max(baseWidth, labelEnd + SVG_PAD / 2));

  const colors = [...new Set(scene.edges.map((e) => e.color))];
  const markerId = (c: string) => `a${colors.indexOf(c)}`;
  const markers = colors
    .map(
      (c) =>
        `<marker id="${markerId(c)}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${xml(c)}"/></marker>`,
    )
    .join('');

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  if (markers) out.push(`<defs>${markers}</defs>`);
  out.push(`<rect width="100%" height="100%" fill="${xml(theme.paper)}"/>`);

  for (const e of scene.edges) {
    const s = scene.nodes[e.source]!;
    const t = scene.nodes[e.target]!;
    const x1 = px(s.x);
    const y1 = py(s.y);
    let x2 = px(t.x);
    let y2 = py(t.y);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > t.size + 2) {
      // A ponta da seta para na borda do alvo, não no centro.
      const k = (len - t.size - 2) / len;
      x2 = x1 + (x2 - x1) * k;
      y2 = y1 + (y2 - y1) * k;
    }
    out.push(
      `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${xml(e.color)}" stroke-width="${r1(e.size)}" marker-end="url(#${markerId(e.color)})"/>`,
    );
  }

  for (const n of scene.nodes) {
    const stroke = n.borderColor ? ` stroke="${xml(n.borderColor)}" stroke-width="1.5"` : '';
    out.push(`<circle cx="${r1(px(n.x))}" cy="${r1(py(n.y))}" r="${r1(n.size)}" fill="${xml(n.color)}"${stroke}/>`);
  }

  const labels = scene.nodes.filter((n) => n.label);
  if (labels.length) {
    out.push(`<g font-family="${fontStack(theme)}" font-size="${LABEL_SIZE}" fill="${xml(theme.ink)}">`);
    for (const n of labels) {
      out.push(`<text x="${r1(px(n.x) + n.size + 4)}" y="${r1(py(n.y) + LABEL_SIZE / 3)}">${xml(n.label)}</text>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}
