import type { AddResult, FileInput } from '@archviewer/core-wasm';
import { abortError, type ScanFile } from './scan';
import type { DirSource } from './source';

export type IngestSkip = { path: string; reason: 'tooLarge' | 'unreadable' };
export type ReadProgress = { read: number; total: number };

/** Leituras em voo ao mesmo tempo; os lotes continuam saindo na ordem da varredura. */
const READ_CONCURRENCY = 12;

export async function readInto(
  src: DirSource,
  files: ScanFile[],
  addFiles: (b: FileInput[]) => Promise<AddResult>,
  opts: {
    maxFileBytes: number;
    batchFiles: number;
    batchBytes: number;
    signal?: AbortSignal;
    concurrency?: number;
    onProgress?: (p: ReadProgress) => void;
  },
): Promise<{ accepted: number; skipped: IngestSkip[] }> {
  const total = files.length;
  const skipped: IngestSkip[] = [];
  let accepted = 0;
  let processed = 0;
  let batch: FileInput[] = [];
  let batchSize = 0;

  const check = () => {
    if (opts.signal?.aborted) throw abortError();
  };
  const progress = () => opts.onProgress?.({ read: processed, total });
  const flush = async () => {
    if (batch.length === 0) return;
    check();
    const b = batch;
    batch = [];
    batchSize = 0;
    accepted += (await addFiles(b)).accepted;
  };

  // Janela de leituras adiantadas [i, i + limit): nunca rejeitam (falha vira null), então
  // abortar com leituras em voo não deixa rejeição solta nem dispara addFiles.
  const limit = Math.max(1, opts.concurrency ?? READ_CONCURRENCY);
  const reads: (Promise<string | null> | undefined)[] = new Array(total);
  let started = 0;
  const startUpTo = (end: number) => {
    for (; started < Math.min(end, total); started++) {
      const f = files[started]!;
      if (f.size > opts.maxFileBytes) continue;
      reads[started] = src.read(f.path).then(
        (c) => c,
        () => null,
      );
    }
  };

  for (let i = 0; i < total; i++) {
    check();
    startUpTo(i + limit);
    const f = files[i]!;
    if (f.size > opts.maxFileBytes) {
      skipped.push({ path: f.path, reason: 'tooLarge' });
      processed++;
      progress();
      continue;
    }
    // Fecha o lote antes de estourar o limite de arquivos ou de bytes.
    if (
      batch.length > 0 &&
      (batch.length + 1 > opts.batchFiles || batchSize + f.size > opts.batchBytes)
    ) {
      await flush();
    }
    const content = await reads[i]!;
    reads[i] = undefined;
    if (content === null) {
      skipped.push({ path: f.path, reason: 'unreadable' });
    } else {
      batch.push({ path: f.path, content });
      batchSize += f.size;
    }
    processed++;
    progress();
  }
  await flush();
  return { accepted, skipped };
}
