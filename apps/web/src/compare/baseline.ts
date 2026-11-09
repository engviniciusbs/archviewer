import type { GraphExport } from '@archviewer/core-wasm';
import type { AnalysisApi } from '../analysis/client';
import { readInto, type ReadProgress } from '../ingest/read';
import { scan } from '../ingest/scan';
import type { DirSource } from '../ingest/source';

export type BaselineOptions = {
  maxFileBytes: number;
  batchFiles: number;
  batchBytes: number;
  signal?: AbortSignal;
  onProgress?: (p: ReadProgress) => void;
};

/**
 * Analisa outra versão do projeto num cliente próprio e devolve o export completo.
 * Mesmo fluxo de ingestão do projeto aberto (pastas ignoradas, `.gitignore`, lotes), sem a confirmação
 * de projeto grande. Quem chama é dono do cliente e o descarta.
 */
export async function analyzeToExport(source: DirSource, client: AnalysisApi, o: BaselineOptions): Promise<GraphExport> {
  await client.start(source.name);
  const files = await scan(source, { ignoredDirs: await client.ignoredDirs(), signal: o.signal });
  const ok = await client.filterIngestible(files.map((f) => f.path));
  const ingestible = files.filter((_, i) => ok[i]);
  o.onProgress?.({ read: 0, total: ingestible.length });
  await readInto(source, ingestible, (b) => client.addFiles(b), {
    maxFileBytes: o.maxFileBytes,
    batchFiles: o.batchFiles,
    batchBytes: o.batchBytes,
    signal: o.signal,
    onProgress: o.onProgress,
  });
  await client.finish();
  const graph = await client.exportGraph();
  if (!graph) throw new Error('the other version produced no graph');
  return graph;
}
