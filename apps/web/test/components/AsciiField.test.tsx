import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsciiField } from '../../src/components/AsciiField';

type Listener = (e: { matches: boolean }) => void;

function mockMotion(initial: boolean) {
  const listeners = new Set<Listener>();
  const mq = {
    matches: initial,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => mq);
  return {
    listeners,
    fire(matches: boolean) {
      mq.matches = matches;
      listeners.forEach((l) => l({ matches }));
    },
  };
}

describe('AsciiField e prefers-reduced-motion', () => {
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  let fills: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    raf = vi.fn(() => 7);
    caf = vi.fn();
    fills = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    const ctx = { setTransform() {}, clearRect() {}, fillText: fills, font: '', fillStyle: '', textBaseline: '', textAlign: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 160, height: 160 } as DOMRect);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('anima por padrão e para ao mudar para movimento reduzido, desenhando um quadro', () => {
    const motion = mockMotion(false);
    render(<AsciiField ratio={0.5} />);
    expect(raf).toHaveBeenCalledTimes(1);
    const before = fills.mock.calls.length;
    motion.fire(true);
    expect(caf).toHaveBeenCalledWith(7);
    expect(fills.mock.calls.length).toBeGreaterThan(before);
  });

  it('começa parado sob movimento reduzido e volta a animar ao sair dele', () => {
    const motion = mockMotion(true);
    render(<AsciiField ratio={0.5} />);
    expect(raf).not.toHaveBeenCalled();
    motion.fire(false);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('remove o ouvinte ao desmontar', () => {
    const motion = mockMotion(false);
    const { unmount } = render(<AsciiField ratio={0} />);
    expect(motion.listeners.size).toBe(1);
    unmount();
    expect(motion.listeners.size).toBe(0);
  });
});
