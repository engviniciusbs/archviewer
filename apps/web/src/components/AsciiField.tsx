import { useEffect, useRef } from 'react';
import { canvasToRgb } from '../renderer/theme';
import { computeField, levelColor, RAMP } from './field';

export const CELL_W = 8;
export const CELL_H = 16;
const FRAME_MS = 1000 / 30;

const GLYPH_TOKENS = ['--color-glyph-1', '--color-glyph-2', '--color-glyph-3', '--color-glyph-4', '--color-accent-deep'];

/** Campo ASCII em canvas, célula de 8x16, que ocupa o contêiner; `ratio` é o progresso real. */
export function AsciiField({ ratio }: { ratio: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;
    const style = getComputedStyle(document.documentElement);
    const palette = GLYPH_TOKENS.map((t) => canvasToRgb(style.getPropertyValue(t).trim()));
    const font = style.getPropertyValue('--font-outlier').trim() || 'monospace';
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    let reduced = mq?.matches ?? false;
    const start = performance.now();
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let visible = true;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cols = Math.floor(box.width / CELL_W);
      rows = Math.floor(box.height / CELL_H);
      canvas.width = cols * CELL_W * dpr;
      canvas.height = rows * CELL_H * dpr;
      canvas.style.width = `${cols * CELL_W}px`;
      canvas.style.height = `${rows * CELL_H}px`;
    };

    const draw = (now: number) => {
      const field = computeField(cols, rows, { ratio: ratioRef.current, t: reduced ? 0 : (now - start) / 1000 });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cols * CELL_W, rows * CELL_H);
      ctx.font = `${CELL_H - 2}px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const level = field[r * cols + c]!;
          const color = levelColor(level);
          if (color === 0) continue;
          ctx.fillStyle = palette[color - 1]!;
          ctx.fillText(RAMP[level]!, c * CELL_W + CELL_W / 2, r * CELL_H + CELL_H / 2);
        }
      }
    };

    const tick = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(tick);
    };
    const run = () => {
      if (reduced || raf || !visible || document.hidden) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    draw(performance.now());
    redrawRef.current = () => {
      if (reduced) draw(performance.now());
    };
    run();

    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resize();
            draw(performance.now());
          });
    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            if (visible) run();
            else stop();
          });
    io?.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : run());
    document.addEventListener('visibilitychange', onVisibility);
    const onMotion = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced) {
        stop();
        draw(performance.now());
      } else run();
    };
    mq?.addEventListener?.('change', onMotion);
    return () => {
      mq?.removeEventListener?.('change', onMotion);
      stop();
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      redrawRef.current = () => {};
    };
  }, []);

  // Sob movimento reduzido há um quadro só; ele é redesenhado quando o progresso muda.
  useEffect(() => {
    redrawRef.current();
  }, [ratio]);

  return <canvas ref={canvasRef} className="ascii-field" aria-hidden="true" />;
}
