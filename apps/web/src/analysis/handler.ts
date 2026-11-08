import type { Analyzer, AddResult, FileInput } from '@archviewer/core-wasm';
import type { FatalFrame, Method, Request, Response } from './protocol';

export type CoreModule = Pick<typeof import('@archviewer/core-wasm'), 'Analyzer' | 'ignoredDirs' | 'isIngestible'>;

const MAX_FILE_BYTES = 2_097_152;

export function createHandler(core: CoreModule): (method: Method, args: unknown[]) => unknown {
  let analyzer: Analyzer | null = null;

  const session = (): Analyzer => {
    if (!analyzer) throw new Error('sessão não iniciada');
    return analyzer;
  };

  return (method, args) => {
    switch (method) {
      case 'ignoredDirs':
        return core.ignoredDirs();
      case 'filterIngestible':
        return (args[0] as string[]).map((p) => core.isIngestible(p));
      case 'start':
        analyzer?.free();
        analyzer = null;
        analyzer = new core.Analyzer({ projectName: args[0] as string, maxFileBytes: MAX_FILE_BYTES });
        return undefined;
      case 'addFiles':
        return session().addFiles(args[0] as FileInput[]) satisfies AddResult;
      case 'finish': {
        const a = session();
        return { summary: a.finish(), issues: a.issues(), defaultExpansion: Array.from(a.defaultExpansion()) };
      }
      case 'view':
        return session().view(args[0] as number[]);
      case 'detail':
        return session().detail(args[0] as number) ?? null;
      case 'find':
        return session().find(args[0] as string, args[1] as number);
    }
  };
}

/** Executa um pedido e monta a resposta; um pânico do WASM vira frame fatal. */
export function respond(
  handle: (method: Method, args: unknown[]) => unknown,
  req: Request,
): Response | FatalFrame {
  try {
    return { id: req.id, ok: true, value: handle(req.method, req.args) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof WebAssembly.RuntimeError) return { fatal: true, error: msg };
    return { id: req.id, ok: false, error: msg };
  }
}
