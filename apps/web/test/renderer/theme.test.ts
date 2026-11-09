// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToRgb, readTheme } from '../../src/renderer/theme';

describe('readTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('converts every color through toRgb and keeps the font untouched', () => {
    const values: Record<string, string> = {
      '--color-paper': 'oklch(98% 0 0)',
      '--color-paper-2': 'oklch(96% 0 0)',
      '--color-ink': 'oklch(21% 0 0)',
      '--color-ink-2': 'oklch(36% 0 0)',
      '--color-muted': 'oklch(50% 0 0)',
      '--color-rule': 'oklch(90% 0 0)',
      '--color-rule-2': 'oklch(83% 0 0)',
      '--color-accent': 'oklch(52% 0.19 258)',
      '--color-accent-wash': 'oklch(95% 0.02 256)',
      '--color-error': 'oklch(52% 0.19 27)',
      '--font-body': ' "IBM Plex Sans", sans-serif ',
      '--color-heat-1': 'h1',
      '--color-heat-2': 'h2',
      '--color-heat-3': 'h3',
      '--color-heat-4': 'h4',
      '--color-heat-5': 'h5',
      '--color-unused': 'u',
      '--color-test-only': 't',
      '--color-added': 'a',
      '--color-changed': 'c',
    };
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (k: string) => values[k] ?? '' }));
    const toRgb = vi.fn((c: string) => `rgb(${c})`);
    const t = readTheme({} as Element, toRgb);
    expect(t.paper).toBe('rgb(oklch(98% 0 0))');
    expect(t.paper2).toBe('rgb(oklch(96% 0 0))');
    expect(t.ink).toBe('rgb(oklch(21% 0 0))');
    expect(t.ink2).toBe('rgb(oklch(36% 0 0))');
    expect(t.muted).toBe('rgb(oklch(50% 0 0))');
    expect(t.rule).toBe('rgb(oklch(90% 0 0))');
    expect(t.rule2).toBe('rgb(oklch(83% 0 0))');
    expect(t.accent).toBe('rgb(oklch(52% 0.19 258))');
    expect(t.accentWash).toBe('rgb(oklch(95% 0.02 256))');
    expect(t.error).toBe('rgb(oklch(52% 0.19 27))');
    expect(t.labelFont).toBe('"IBM Plex Sans", sans-serif');
    expect(t.heat).toEqual(['rgb(h1)', 'rgb(h2)', 'rgb(h3)', 'rgb(h4)', 'rgb(h5)']);
    expect([t.unused, t.testOnly]).toEqual(['rgb(u)', 'rgb(t)']);
    expect([t.added, t.changed]).toEqual(['rgb(a)', 'rgb(c)']);
    expect(toRgb).toHaveBeenCalledTimes(19);
  });

  it('canvasToRgb returns the input when there is no canvas', () => {
    expect(canvasToRgb('oklch(50% 0 0)')).toBe('oklch(50% 0 0)');
  });
});
