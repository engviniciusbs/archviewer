import type { Summary } from '@archviewer/core-wasm';

export const APP_URL = 'https://archviewer.viniciusbsarmento.com';
const OK = '2ea043';
const WARN = 'd4a72c';

const int = new Intl.NumberFormat('en');
const count = (n: number, one: string, other: string) => `${int.format(n)} ${n === 1 ? one : other}`;

/** Escape do shields.io: `-` e `_` são separadores, então dobram; o resto vai em URL encoding. */
export function shieldsEscape(text: string): string {
  return encodeURIComponent(text.replace(/-/g, '--').replace(/_/g, '__'));
}

/** Snippet de README, sempre em inglês, com as contagens do momento da exportação. */
export function badgeMarkdown(s: Pick<Summary, 'files' | 'cycles'>): string {
  const message = `${count(s.files, 'file', 'files')} · ${count(s.cycles, 'cycle', 'cycles')}`;
  const color = s.cycles === 0 ? OK : WARN;
  const image = `https://img.shields.io/badge/${shieldsEscape('architecture')}-${shieldsEscape(message)}-${color}`;
  return `[![architecture: ${message}](${image})](${APP_URL})`;
}
