import type {
  AddResult,
  Detail,
  FileInput,
  Issues,
  SearchHit,
  Summary,
  VisibleGraph,
} from '@archviewer/core-wasm';
import type { Method, Request, WorkerMessage } from './protocol';

export interface FinishResult {
  summary: Summary;
  issues: Issues;
  defaultExpansion: number[];
}

export interface AnalysisApi {
  ignoredDirs(): Promise<string[]>;
  start(projectName: string): Promise<void>;
  filterIngestible(paths: string[]): Promise<boolean[]>;
  addFiles(batch: FileInput[]): Promise<AddResult>;
  finish(): Promise<FinishResult>;
  view(expanded: number[]): Promise<VisibleGraph>;
  detail(id: number): Promise<Detail | null>;
  find(query: string, limit: number): Promise<SearchHit[]>;
  onCrash(cb: (message: string) => void): () => void;
  dispose(): void;
}

export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;

export class WorkerCrashedError extends Error {
  constructor(detail?: string) {
    super(detail ? `analysis worker stopped: ${detail}` : 'analysis worker stopped');
    this.name = 'WorkerCrashedError';
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class AnalysisClient implements AnalysisApi {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private crashCbs = new Set<(message: string) => void>();
  private dead: Error | null = null;

  constructor(private worker: WorkerLike) {
    worker.addEventListener('message', (e) => this.onMessage((e as MessageEvent<WorkerMessage>).data));
    worker.addEventListener('error', (e) => this.crash((e as ErrorEvent).message));
    worker.addEventListener('messageerror', () => this.crash('unreadable message'));
  }

  private onMessage(res: WorkerMessage): void {
    if ('fatal' in res) {
      this.crash(res.error);
      return;
    }
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error));
  }

  private crash(detail?: string): void {
    if (this.dead) return;
    const err = new WorkerCrashedError(detail || undefined);
    this.dead = err;
    this.rejectAll(err);
    for (const cb of [...this.crashCbs]) cb(err.message);
  }

  private rejectAll(err: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(err);
  }

  private call<T>(method: Method, ...args: unknown[]): Promise<T> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      const req: Request = { id, method, args };
      this.worker.postMessage(req);
    });
  }

  ignoredDirs() {
    return this.call<string[]>('ignoredDirs');
  }
  start(projectName: string) {
    return this.call<void>('start', projectName);
  }
  filterIngestible(paths: string[]) {
    return this.call<boolean[]>('filterIngestible', paths);
  }
  addFiles(batch: FileInput[]) {
    return this.call<AddResult>('addFiles', batch);
  }
  finish() {
    return this.call<FinishResult>('finish');
  }
  view(expanded: number[]) {
    return this.call<VisibleGraph>('view', expanded);
  }
  detail(id: number) {
    return this.call<Detail | null>('detail', id);
  }
  find(query: string, limit: number) {
    return this.call<SearchHit[]>('find', query, limit);
  }

  onCrash(cb: (message: string) => void): () => void {
    this.crashCbs.add(cb);
    return () => {
      this.crashCbs.delete(cb);
    };
  }

  dispose(): void {
    if (this.dead) return;
    const err = new Error('analysis closed');
    this.dead = err;
    this.worker.terminate();
    this.rejectAll(err);
  }
}

export function createAnalysisClient(): AnalysisClient {
  return new AnalysisClient(new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }));
}
