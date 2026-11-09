export type Method =
  | 'ignoredDirs'
  | 'start'
  | 'filterIngestible'
  | 'addFiles'
  | 'finish'
  | 'view'
  | 'detail'
  | 'find'
  | 'exportGraph';

export type Request = { id: number; method: Method; args: unknown[] };

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/**
 * O WASM entrou em pânico (`WebAssembly.RuntimeError`): o módulo ficou envenenado e o worker
 * se encerra. Sem id, porque derruba a sessão inteira, não só um pedido.
 */
export type FatalFrame = { fatal: true; error: string };

export type WorkerMessage = Response | FatalFrame;
