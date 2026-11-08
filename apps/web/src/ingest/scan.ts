import { GitignoreStack } from './gitignore';
import type { DirEntry, DirSource } from './source';

export type ScanFile = { path: string; size: number };

export function abortError(): DOMException {
  return new DOMException('cancelado', 'AbortError');
}

export async function scan(
  src: DirSource,
  opts: {
    ignoredDirs: string[];
    signal?: AbortSignal;
    /** Pasta abaixo da raiz que não pôde ser listada; a varredura segue sem ela. */
    onUnreadable?: (path: string) => void;
  },
): Promise<ScanFile[]> {
  const ignored = new Set(opts.ignoredDirs);
  const git = new GitignoreStack();
  const out: ScanFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (opts.signal?.aborted) throw abortError();
    let entries: DirEntry[];
    try {
      entries = await src.list(dir);
    } catch (e) {
      // A raiz ilegível é fatal; uma subpasta ilegível só fica de fora.
      if (opts.signal?.aborted) throw abortError();
      if (dir === '') throw e;
      opts.onUnreadable?.(dir);
      return;
    }
    const join = (name: string) => (dir ? `${dir}/${name}` : name);

    // O .gitignore do diretório vale antes de julgar os filhos.
    if (entries.some((e) => e.kind === 'file' && e.name === '.gitignore')) {
      try {
        git.add(dir, await src.read(join('.gitignore')));
      } catch {
        // .gitignore ilegível: segue sem ele.
      }
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const path = join(e.name);
      if (e.kind === 'dir') {
        if (ignored.has(e.name) || e.name.startsWith('.') || git.ignores(path, true)) continue;
        await walk(path);
      } else if (!git.ignores(path, false)) {
        out.push({ path, size: e.size });
      }
    }
  }

  await walk('');
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
