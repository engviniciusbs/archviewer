/** Rampa de caracteres, do vazio ao mais denso. */
export const RAMP = ' .:-=+*#%@';

export interface FieldParams {
  /** Progresso real, 0..1: a fronteira entre "cru" e "resolvido". */
  ratio: number;
  /** Tempo em segundos; o ruído cru muda a 30 quadros por segundo. */
  t: number;
}

const BAND = 2;
/** Níveis do ruído cru e do padrão resolvido não se sobrepõem, então os dois lados se distinguem. */
const RAW_LEVELS = [1, 2, 3, 6, 7, 8] as const;

function hash(col: number, row: number, frame: number): number {
  let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ Math.imul(frame + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Padrão regular e estável do lado resolvido: níveis 4 e 5, com um furo a cada três células. */
function resolved(col: number, row: number): number {
  if ((col + row) % 3 === 0) return 0;
  return (col >> 1) % 2 === row % 2 ? 5 : 4;
}

/**
 * Nível 0..9 por célula, linha a linha. À esquerda da fronteira o padrão resolvido; à direita ruído cru
 * cuja densidade cresce com o progresso; o nível 9 só ocupa as 2 colunas da fronteira.
 */
export function computeField(cols: number, rows: number, p: FieldParams): Uint8Array {
  const out = new Uint8Array(Math.max(0, cols) * Math.max(0, rows));
  const ratio = Math.min(1, Math.max(0, p.ratio));
  const boundary = Math.floor(ratio * cols);
  const frame = Math.floor(p.t * 30);
  const density = 0.1 + 0.5 * ratio;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let level: number;
      if (c < boundary) level = resolved(c, r);
      else if (c < boundary + BAND) level = 9;
      else {
        const h = hash(c, r, frame);
        level = h < density ? RAW_LEVELS[Math.floor((h / density) * RAW_LEVELS.length)]! : 0;
      }
      out[r * cols + c] = level;
    }
  }
  return out;
}

/** 0 = vazio, 1..4 = `--color-glyph-1..4`, 5 = `--color-accent-deep`. */
export function levelColor(level: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (level <= 0) return 0;
  if (level >= 9) return 5;
  if (level <= 2) return 1;
  if (level <= 4) return 2;
  if (level <= 6) return 3;
  return 4;
}
