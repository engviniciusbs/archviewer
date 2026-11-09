import type { VNode } from '@archviewer/core-wasm';
import type { Messages } from '../i18n/messages/en';

export type ColorBy = 'none' | 'fanIn' | 'fanOut' | 'loc' | 'unused';
export type HeatMetric = Exclude<ColorBy, 'none' | 'unused'>;
export const COLOR_BY: ColorBy[] = ['none', 'fanIn', 'fanOut', 'loc', 'unused'];

export const isColorBy = (v: string | null): v is ColorBy => v !== null && (COLOR_BY as string[]).includes(v);

const QUANTILES = [0.2, 0.4, 0.6, 0.8];
const RAMP_STEPS = 5;

export type Band = { min: number; max: number };
export interface HeatScale {
  bands: Band[];
  /** Índice da faixa de `v`; 0 sem faixas. */
  band(v: number): number;
}

/** Valor da métrica num nó; null quando ela não se aplica (externo em linhas ou fan-out). */
export function metricOf(n: VNode, m: HeatMetric): number | null {
  if (n.kind === 'external' && m !== 'fanIn') return null;
  return n.metrics[m];
}

/**
 * Até cinco faixas inteiras, cortadas nos quantis 0,2/0,4/0,6/0,8 dos valores desenhados.
 * Quantis em vez de intervalos iguais: um único "arquivo-deus" não achata o resto.
 */
export function heatScale(values: number[]): HeatScale {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { bands: [], band: () => 0 };
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const cuts = [...new Set(QUANTILES.map((q) => sorted[Math.floor(q * (sorted.length - 1))]!))].filter(
    (c) => c < max,
  );
  const bands: Band[] = [];
  let lo = min;
  for (const c of [...cuts, max]) {
    if (c >= lo) bands.push({ min: lo, max: c });
    lo = c + 1;
  }
  return {
    bands,
    band(v) {
      const i = bands.findIndex((b) => v <= b.max);
      return i === -1 ? bands.length - 1 : i;
    },
  };
}

/** Com menos de cinco faixas, as cores se espalham pela rampa (uma faixa só fica no meio). */
export function heatColorIndex(band: number, bands: number): number {
  if (bands <= 1) return Math.floor(RAMP_STEPS / 2);
  return Math.round((band * (RAMP_STEPS - 1)) / (bands - 1));
}

export type HeatColors = { heat: string[]; unused: string; testOnly: string };
export type Legend = { title: string; items: { color: string; label: string }[] };

const rangeLabel = (b: Band, t: Messages) =>
  b.min === b.max ? t.fmt.int(b.min) : `${t.fmt.int(b.min)}–${t.fmt.int(b.max)}`;

/** Legenda do modo ativo sobre os nós desenhados; null sem heatmap ou sem valores. */
export function heatLegend(
  colorBy: ColorBy,
  nodes: VNode[],
  t: Messages,
  colors: HeatColors,
): Legend | null {
  if (colorBy === 'none') return null;
  if (colorBy === 'unused') {
    return {
      title: t.heat.unused,
      items: [
        { color: colors.unused, label: t.heat.unused },
        { color: colors.testOnly, label: t.heat.testOnly },
      ],
    };
  }
  const scale = heatScale(nodes.map((n) => metricOf(n, colorBy)).filter((v): v is number => v !== null));
  if (scale.bands.length === 0) return null;
  return {
    title: t.heat[colorBy],
    items: scale.bands.map((b, i) => ({
      color: colors.heat[heatColorIndex(i, scale.bands.length)]!,
      label: rangeLabel(b, t),
    })),
  };
}

/**
 * Cor de cada nó no modo ativo (a seleção e o esmaecimento continuam nos reducers).
 * `undefined` mantém o visual padrão.
 */
export function heatPainter(
  colorBy: ColorBy,
  nodes: VNode[],
  testOnly: ReadonlySet<string>,
  colors: HeatColors,
): ((n: VNode) => { color?: string; borderColor?: string } | undefined) | undefined {
  if (colorBy === 'none') return undefined;
  if (colorBy === 'unused') {
    return (n) => {
      if (n.kind === 'file' && n.metrics.unused > 0) return { color: colors.unused };
      if (n.kind === 'file' && testOnly.has(n.path)) return { color: colors.testOnly };
      if (n.kind === 'group' && n.metrics.unused > 0) return { borderColor: colors.unused };
      return undefined;
    };
  }
  const scale = heatScale(nodes.map((n) => metricOf(n, colorBy)).filter((v): v is number => v !== null));
  return (n) => {
    const v = metricOf(n, colorBy);
    if (v === null) return undefined;
    return { color: colors.heat[heatColorIndex(scale.band(v), scale.bands.length)] };
  };
}
