export interface GraphTheme {
  paper: string;
  paper2: string;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  rule2: string;
  accent: string;
  accentWash: string;
  error: string;
  labelFont: string;
  /** Rampa do heatmap, do claro ao escuro. */
  heat: string[];
  unused: string;
  testOnly: string;
}

/** Lê os tokens do documento; o Sigma não entende oklch, então toda cor passa por `toRgb`. */
export function readTheme(root: Element, toRgb: (css: string) => string): GraphTheme {
  const style = getComputedStyle(root);
  const raw = (name: string) => style.getPropertyValue(name).trim();
  const color = (name: string) => toRgb(raw(name));
  return {
    paper: color('--color-paper'),
    paper2: color('--color-paper-2'),
    ink: color('--color-ink'),
    ink2: color('--color-ink-2'),
    muted: color('--color-muted'),
    rule: color('--color-rule'),
    rule2: color('--color-rule-2'),
    accent: color('--color-accent'),
    accentWash: color('--color-accent-wash'),
    error: color('--color-error'),
    labelFont: raw('--font-body'),
    heat: [1, 2, 3, 4, 5].map((i) => color(`--color-heat-${i}`)),
    unused: color('--color-unused'),
    testOnly: color('--color-test-only'),
  };
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** Converte qualquer cor CSS para `rgb(r, g, b)` via canvas 1x1; sem canvas devolve a entrada. */
export function canvasToRgb(css: string): string {
  try {
    if (ctx === undefined) {
      if (typeof document === 'undefined') {
        ctx = null;
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
    }
    if (!ctx) return css;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return css;
  }
}
