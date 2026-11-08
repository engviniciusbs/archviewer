import type { SkipReason, UnresolvedReason } from '@archviewer/core-wasm';
import type { IngestSkip } from '../ingest/read';

const int = new Intl.NumberFormat('pt-BR');
const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatInt = (n: number): string => int.format(n);

/** `1 arquivo`, `2 arquivos`, `1.234 arquivos`. */
export const count = (n: number, singular: string, plural: string): string =>
  `${int.format(n)} ${n === 1 ? singular : plural}`;

/** Milissegundos em segundos com uma casa decimal: `0,4 s`. */
export const seconds = (ms: number): string => `${oneDecimal.format(ms / 1000)} s`;

/** Último segmento de um caminho (`src/a.ts` → `a.ts`). */
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const REASON: Record<UnresolvedReason, string> = {
  notFound: 'não encontrado',
  asset: 'asset',
  unknownAlias: 'alias desconhecido',
};

export const SKIP_REASON: Record<SkipReason | IngestSkip['reason'], string> = {
  tooLarge: 'maior que 2 MB',
  notIngestible: 'não suportado',
  unreadable: 'ilegível',
};
