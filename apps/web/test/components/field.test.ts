import { describe, expect, it } from 'vitest';
import { computeField, levelColor, RAMP } from '../../src/components/field';

const COLS = 60;
const ROWS = 12;
const nonEmpty = (f: Uint8Array) => f.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
const at = (f: Uint8Array, col: number, row: number) => f[row * COLS + col]!;

describe('computeField', () => {
  it('é determinístico para os mesmos parâmetros', () => {
    const a = computeField(COLS, ROWS, { ratio: 0.5, t: 0.4 });
    const b = computeField(COLS, ROWS, { ratio: 0.5, t: 0.4 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).toHaveLength(COLS * ROWS);
  });

  it('com ratio 0 nenhuma célula segue o padrão resolvido e no máximo 15% são não vazias', () => {
    const f = computeField(COLS, ROWS, { ratio: 0, t: 0 });
    expect(nonEmpty(f) / f.length).toBeLessThanOrEqual(0.15);
    // o padrão resolvido (ratio 1) não aparece em lugar nenhum além das colunas da fronteira
    const resolved = computeField(COLS, ROWS, { ratio: 1, t: 0 });
    let matches = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 2; c < COLS; c++) if (at(f, c, r) > 0 && at(f, c, r) === at(resolved, c, r)) matches++;
    expect(matches).toBe(0);
  });

  it('a densidade cresce com o ratio', () => {
    const low = nonEmpty(computeField(COLS, ROWS, { ratio: 0.2, t: 0 }));
    const high = nonEmpty(computeField(COLS, ROWS, { ratio: 0.8, t: 0 }));
    expect(high).toBeGreaterThan(low);
  });

  it('a região à esquerda da fronteira não muda com t', () => {
    const ratio = 0.5;
    const a = computeField(COLS, ROWS, { ratio, t: 0 });
    const b = computeField(COLS, ROWS, { ratio, t: 1 });
    const boundary = Math.floor(ratio * COLS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < boundary; c++) expect(at(a, c, r)).toBe(at(b, c, r));
  });

  it('o nível 9 só aparece nas 2 colunas da fronteira', () => {
    for (const ratio of [0.1, 0.5, 0.9, 1]) {
      const f = computeField(COLS, ROWS, { ratio, t: 0.3 });
      const boundary = Math.floor(ratio * COLS);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (at(f, c, r) === 9) expect(c >= boundary && c < boundary + 2).toBe(true);
    }
  });

  it('levelColor mapeia 0 a vazio, 1..8 a glifos e 9 a accent-deep', () => {
    expect(levelColor(0)).toBe(0);
    expect(levelColor(9)).toBe(5);
    for (let l = 1; l <= 8; l++) expect([1, 2, 3, 4]).toContain(levelColor(l));
    expect(RAMP).toHaveLength(10);
  });
});
