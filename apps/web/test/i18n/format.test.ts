import { describe, expect, it } from 'vitest';
import { formatInt, formatSeconds, plural } from '../../src/i18n/format';

describe('plural', () => {
  it('escolhe a forma e formata o número no idioma', () => {
    expect(plural('en', 1, { one: '# file', other: '# files' })).toBe('1 file');
    expect(plural('en', 1234, { one: '# file', other: '# files' })).toBe('1,234 files');
    expect(plural('pt-BR', 1234, { '=1': '# arquivo', other: '# arquivos' })).toBe('1.234 arquivos');
  });

  it('formas exatas (=N) vencem as regras do idioma', () => {
    // No CLDR, pt trata 0 como "one"; o app mostra "0 arquivos".
    expect(plural('pt-BR', 0, { one: '# arquivo', other: '# arquivos' })).toBe('0 arquivo');
    expect(plural('pt-BR', 0, { '=1': '# arquivo', other: '# arquivos' })).toBe('0 arquivos');
    expect(plural('pt-BR', 1, { '=1': '# arquivo', other: '# arquivos' })).toBe('1 arquivo');
  });
});

describe('números', () => {
  it('inteiros e segundos seguem o idioma', () => {
    expect(formatInt('en', 1234)).toBe('1,234');
    expect(formatInt('pt-BR', 1234)).toBe('1.234');
    expect(formatSeconds('pt-BR', 420)).toBe('0,4 s');
    expect(formatSeconds('en', 420)).toBe('0.4 s');
  });
});
