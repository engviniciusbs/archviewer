import type { WarningCode } from '@archviewer/core-wasm';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n/locales';

const CODES: WarningCode[] = [
  'extendsNotFound',
  'invalidTsconfig',
  'tsconfigReferenceNotFound',
  'tsconfigIgnored',
  'invalidGlob',
  'invalidPackageJson',
];

describe('mensagens', () => {
  it.each(LOCALES.map((l) => [l.code, l] as const))('%s traduz todo WarningCode', (_, l) => {
    for (const code of CODES) expect(l.messages.warnings[code]('x/y.json')).toContain('x/y.json');
  });
});
