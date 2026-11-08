import { describe, expect, it } from 'vitest';
import { GitignoreStack } from '../../src/ingest/gitignore';

describe('GitignoreStack', () => {
  it('aplica padrões da raiz e negação', () => {
    const g = new GitignoreStack();
    g.add('', 'dist\n*.log\n!keep.log');
    expect(g.ignores('dist', true)).toBe(true);
    expect(g.ignores('a.log', false)).toBe(true);
    expect(g.ignores('keep.log', false)).toBe(false);
  });

  it('padrões aninhados valem só para o seu diretório', () => {
    const g = new GitignoreStack();
    g.add('pkg', 'gen/');
    expect(g.ignores('pkg/gen', true)).toBe(true);
    expect(g.ignores('gen', true)).toBe(false);
  });
});
