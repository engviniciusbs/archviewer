/** Último segmento de um caminho (`src/a.ts` → `a.ts`). */
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
