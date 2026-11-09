import { isColorBy, type ColorBy } from '../renderer/heat';
import type { Filters } from './graph-store';

export function readFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const hide = new Set((p.get('hide') ?? '').split(',').map((s) => s.trim()));
  return {
    hideExternals: hide.has('externals'),
    hideTypeOnly: hide.has('typeOnly'),
    hideAssets: hide.has('assets'),
    cyclesOnly: p.get('cycles') === '1',
  };
}

export function readColorBy(search: string): ColorBy {
  const v = new URLSearchParams(search).get('color');
  // "changes" depende de uma comparação, que não sobrevive a um recarregamento.
  return isColorBy(v) && v !== 'changes' ? v : 'none';
}

/** '' quando tudo é padrão; senão uma string iniciada por '?'. */
export function writeFilters(f: Filters, colorBy: ColorBy = 'none'): string {
  const hide: string[] = [];
  if (f.hideExternals) hide.push('externals');
  if (f.hideTypeOnly) hide.push('typeOnly');
  if (f.hideAssets) hide.push('assets');
  const parts: string[] = [];
  if (hide.length > 0) parts.push(`hide=${hide.join(',')}`);
  if (f.cyclesOnly) parts.push('cycles=1');
  if (colorBy !== 'none' && colorBy !== 'changes') parts.push(`color=${colorBy}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
