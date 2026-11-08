import { describe, expect, it } from 'vitest';
import { readFilters, writeFilters } from '../../src/store/url';
import type { Filters } from '../../src/store/graph-store';

const none: Filters = { hideExternals: false, hideTypeOnly: false, hideAssets: false, cyclesOnly: false };

describe('url', () => {
  it('padrão vira string vazia', () => {
    expect(writeFilters(none)).toBe('');
  });
  it('escreve hide e cycles', () => {
    expect(writeFilters({ ...none, hideExternals: true, hideAssets: true })).toBe('?hide=externals,assets');
    expect(writeFilters({ ...none, cyclesOnly: true })).toBe('?cycles=1');
    expect(writeFilters({ hideExternals: true, hideTypeOnly: true, hideAssets: true, cyclesOnly: true })).toBe(
      '?hide=externals,typeOnly,assets&cycles=1',
    );
  });
  it('lê e ignora valores desconhecidos', () => {
    expect(readFilters('?hide=typeOnly,foo&cycles=1')).toEqual({ ...none, hideTypeOnly: true, cyclesOnly: true });
    expect(readFilters('')).toEqual(none);
    expect(readFilters('?cycles=0')).toEqual(none);
  });
  it('ida e volta', () => {
    for (let m = 0; m < 16; m++) {
      const f: Filters = {
        hideExternals: !!(m & 1),
        hideTypeOnly: !!(m & 2),
        hideAssets: !!(m & 4),
        cyclesOnly: !!(m & 8),
      };
      expect(readFilters(writeFilters(f))).toEqual(f);
    }
  });
});
