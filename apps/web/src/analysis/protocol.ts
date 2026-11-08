export type Method =
  | 'ignoredDirs'
  | 'start'
  | 'filterIngestible'
  | 'addFiles'
  | 'finish'
  | 'view'
  | 'detail'
  | 'find';

export type Request = { id: number; method: Method; args: unknown[] };

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };
