// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncThenLayout, type LayoutHost, type LayoutLike } from '../../src/renderer/layout';

const fake = (log: string[], name: string): LayoutLike => ({
  start: () => log.push(`${name}.start`),
  stop: () => log.push(`${name}.stop`),
  kill: () => log.push(`${name}.kill`),
});

describe('syncThenLayout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('kills the running layout before mutating, then starts a new one', () => {
    const log: string[] = [];
    const host: LayoutHost = { layout: fake(log, 'old'), timer: null };
    syncThenLayout(host, {
      capture: () => log.push('capture'),
      mutate: () => {
        log.push('mutate');
        return { added: 2, durationMs: 800, pinned: new Set(['1']) };
      },
      create: () => fake(log, 'new'),
      onSettled: () => log.push('settled'),
    });
    expect(log).toEqual(['old.stop', 'old.kill', 'capture', 'mutate', 'new.start']);
    vi.advanceTimersByTime(800);
    expect(log.slice(5)).toEqual(['new.stop', 'new.kill', 'capture', 'settled']);
    expect(host.layout).toBeNull();
  });

  it('does not start a layout when nothing was added', () => {
    const log: string[] = [];
    const host: LayoutHost = { layout: fake(log, 'old'), timer: null };
    syncThenLayout(host, {
      capture: () => {},
      mutate: () => ({ added: 0 }),
      create: () => fake(log, 'new'),
      onSettled: () => {},
    });
    expect(log).toEqual(['old.stop', 'old.kill']);
    expect(host.layout).toBeNull();
  });
});
