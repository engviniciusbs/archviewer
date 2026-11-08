// @vitest-environment node
import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { PositionCache, placeChildren } from '../../src/renderer/positions';

describe('placeChildren', () => {
  it('is deterministic, equidistant and order independent', () => {
    const a = placeChildren({ x: 0, y: 0 }, [3, 1, 2]);
    const b = placeChildren({ x: 0, y: 0 }, [2, 3, 1]);
    const r = 10 + 4 * Math.sqrt(3);
    expect(a.size).toBe(3);
    const keys = new Set<string>();
    for (const id of [1, 2, 3]) {
      const p = a.get(id)!;
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(r, 6);
      expect(b.get(id)).toEqual(p);
      keys.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
    }
    expect(keys.size).toBe(3);
    expect(placeChildren({ x: 0, y: 0 }, [3, 1, 2])).toEqual(a);
  });

  it('centers on the parent', () => {
    const p = placeChildren({ x: 100, y: -50 }, [1]).get(1)!;
    expect(Math.hypot(p.x - 100, p.y + 50)).toBeCloseTo(14, 6);
  });
});

describe('PositionCache', () => {
  it('stores and captures', () => {
    const c = new PositionCache();
    c.set(1, 2, 3);
    expect(c.get(1)).toEqual({ x: 2, y: 3 });
    const g = new Graph();
    g.addNode('7', { x: 5, y: 6, nodeId: 7 });
    c.capture(g);
    expect(c.get(7)).toEqual({ x: 5, y: 6 });
    expect(c.get(99)).toBeUndefined();
  });
});
