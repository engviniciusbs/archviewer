/// <reference lib="webworker" />
import init, * as core from '@archviewer/core-wasm';
import { createHandler, respond } from './handler';
import type { Request, WorkerMessage } from './protocol';

const ready: Promise<void> = init().then(
  () => undefined,
);
const handle = createHandler(core);

function reply(res: WorkerMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
}

self.addEventListener('message', (e: MessageEvent<Request>) => {
  const { id, method, args } = e.data;
  void ready.then(
    () => {
      const res = respond(handle, { id, method, args });
      reply(res);
      // Depois de um pânico o módulo WASM não é confiável: encerra e o cliente vai para crash().
      if ('fatal' in res) (self as unknown as DedicatedWorkerGlobalScope).close();
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      reply({ id, ok: false, error: `falha ao carregar o WASM: ${msg}` });
    },
  );
});
