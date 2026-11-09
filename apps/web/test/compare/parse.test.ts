import { describe, expect, it } from 'vitest';
import { parseExport } from '../../src/compare/parse';
import { g } from './helpers';

describe('parseExport', () => {
  it('aceita um export do ArchViewer', () => {
    const r = parseExport(JSON.stringify(g()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.graph.files).toHaveLength(2);
  });

  it('recusa o que não é um export', () => {
    const base = g() as unknown as Record<string, unknown>;
    for (const text of [
      '{',
      '[]',
      '"x"',
      'null',
      JSON.stringify({ ...base, version: 2 }),
      JSON.stringify({ ...base, schema: 'https://example.com/other.json' }),
      JSON.stringify({ ...base, files: undefined }),
      JSON.stringify({ ...base, edges: 'nope' }),
      JSON.stringify({ ...base, files: [{ nope: 1 }] }),
    ]) {
      expect(parseExport(text).ok, text.slice(0, 60)).toBe(false);
    }
  });
});
