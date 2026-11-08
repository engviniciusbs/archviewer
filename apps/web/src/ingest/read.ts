import type { AddResult, FileInput } from '@archviewer/core-wasm';
import { abortError, type ScanFile } from './scan';
import type { DirSource } from './source';

export type IngestSkip = { path: string; reason: 'tooLarge' | 'unreadable' };
export type ReadProgress = { read: number; total: number };

export async function readInto(
  src: DirSource,
  files: ScanFile[],
  addFiles: (b: FileInput[]) => Promise<AddResult>,
  opts: {
    maxFileBytes: number;
    batchFiles: number;
    batchBytes: number;
    signal?: AbortSignal;
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

  for (const f of files) {
    check();
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
    try {
      const content = await src.read(f.path);
      batch.push({ path: f.path, content });
      batchSize += f.size;
    } catch {
      skipped.push({ path: f.path, reason: 'unreadable' });
    }
    processed++;
    progress();
  }
  await flush();
  return { accepted, skipped };
}
