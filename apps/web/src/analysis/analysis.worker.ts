/// <reference lib="webworker" />
import init, * as core from '@archviewer/core-wasm';
import { createHandler } from './handler';
import type { Request, Response } from './protocol';

const ready: Promise<void> = init().then(
  () => undefined,
);
const handle = createHandler(core);

function reply(res: Response): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
}

self.addEventListener('message', (e: MessageEvent<Request>) => {
  const { id, method, args } = e.data;
  void ready.then(
    () => {
      try {
        reply({ id, ok: true, value: handle(method, args) });
      } catch (err) {
        reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      reply({ id, ok: false, error: `falha ao carregar o WASM: ${msg}` });
    },
  );
});
