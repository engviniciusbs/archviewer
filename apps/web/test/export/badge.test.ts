import { describe, expect, it } from 'vitest';
import { badgeMarkdown, shieldsEscape } from '../../src/export/badge';

describe('badgeMarkdown', () => {
  it('gera o snippet com contagens, cor verde e link para o app', () => {
    expect(badgeMarkdown({ files: 61, cycles: 0 })).toBe(
      '[![architecture: 61 files · 0 cycles](https://img.shields.io/badge/architecture-61%20files%20%C2%B7%200%20cycles-2ea043)](https://archviewer.viniciusbsarmento.com)',
    );
  });

  it('usa singular e laranja quando há ciclos', () => {
    const md = badgeMarkdown({ files: 1, cycles: 2 });
    expect(md).toContain('1%20file%20%C2%B7%202%20cycles');
    expect(md).toContain('-d4a72c)');
    expect(badgeMarkdown({ files: 2, cycles: 1 })).toContain('1%20cycle-');
  });

  it('separa milhares sem vírgula ambígua', () => {
    expect(badgeMarkdown({ files: 12345, cycles: 0 })).toContain('12%2C345%20files');
  });
});

describe('shieldsEscape', () => {
  it('dobra hífen e sublinhado e codifica o resto', () => {
    expect(shieldsEscape('a-b_c d')).toBe('a--b__c%20d');
  });
});
