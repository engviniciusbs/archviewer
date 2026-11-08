export interface LayoutLike {
  start(): unknown;
  stop(): unknown;
  kill(): unknown;
}

export interface LayoutHost {
  layout: LayoutLike | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Para e destrói o layout atual; só uma instância existe por vez. */
export function stopLayout(host: LayoutHost, capture: () => void): void {
  if (host.timer) clearTimeout(host.timer);
  host.timer = null;
  const layout = host.layout;
  host.layout = null;
  if (!layout) return;
  layout.stop();
  layout.kill();
  capture();
}

/**
 * Para o layout ANTES de mutar o grafo (o supervisor do FA2 reage a cada evento do grafo com um
 * setTimeout que `kill()` não cancela, e vazaria um worker), muta, e só então inicia um novo layout.
 */
export function syncThenLayout(
  host: LayoutHost,
  ops: {
    capture: () => void;
    mutate: () => { added: number } | { added: number; durationMs: number; pinned: Set<string> };
    create: (pinned: Set<string>) => LayoutLike | null;
    onSettled: () => void;
  },
): void {
  stopLayout(host, ops.capture);
  const res = ops.mutate();
  if (res.added === 0 || !('durationMs' in res)) return;
  const layout = ops.create(res.pinned);
  if (!layout) return;
  host.layout = layout;
  layout.start();
  host.timer = setTimeout(() => {
    if (host.layout !== layout) return;
    stopLayout(host, ops.capture);
    ops.onSettled();
  }, res.durationMs);
}
