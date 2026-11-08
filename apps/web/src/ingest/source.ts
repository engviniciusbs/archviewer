export type DirEntry = { name: string; kind: 'file' | 'dir'; size: number };

export interface DirSource {
  name: string;
  list(dir: string): Promise<DirEntry[]>;
  read(path: string): Promise<string>;
}

/** Lista os filhos diretos de `dir` a partir de um índice plano de caminhos -> tamanho. */
function listFromIndex(index: Map<string, number>, dir: string): DirEntry[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const out = new Map<string, DirEntry>();
  for (const [path, size] of index) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) out.set(rest, { name: rest, kind: 'file', size });
    else {
      const name = rest.slice(0, slash);
      if (!out.has(name)) out.set(name, { name, kind: 'dir', size: 0 });
    }
  }
  return [...out.values()];
}

export function memorySource(name: string, files: Record<string, string>): DirSource {
  const enc = new TextEncoder();
  const index = new Map<string, number>();
  for (const [path, content] of Object.entries(files)) index.set(path, enc.encode(content).length);
  return {
    name,
    list: async (dir) => listFromIndex(index, dir),
    read: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`arquivo não encontrado: ${path}`);
      return content;
    },
  };
}

export function fromFileList(files: ArrayLike<File>): DirSource {
  const byPath = new Map<string, File>();
  const index = new Map<string, number>();
  let rootName = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const rel = f.webkitRelativePath || f.name;
    const segs = rel.split('/');
    let path: string;
    if (segs.length > 1) {
      if (!rootName) rootName = segs[0]!;
      path = segs.slice(1).join('/');
    } else {
      path = rel;
    }
    byPath.set(path, f);
    index.set(path, f.size);
  }
  return {
    name: rootName,
    list: async (dir) => listFromIndex(index, dir),
    read: async (path) => {
      const f = byPath.get(path);
      if (!f) throw new Error(`arquivo não encontrado: ${path}`);
      return f.text();
    },
  };
}

export function fromDirectoryHandle(handle: FileSystemDirectoryHandle): DirSource {
  const dirs = new Map<string, FileSystemDirectoryHandle>([['', handle]]);

  async function dirHandle(path: string): Promise<FileSystemDirectoryHandle> {
    const cached = dirs.get(path);
    if (cached) return cached;
    let cur = handle;
    let acc = '';
    for (const seg of path.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      const known = dirs.get(acc);
      if (known) {
        cur = known;
        continue;
      }
      cur = await cur.getDirectoryHandle(seg);
      dirs.set(acc, cur);
    }
    return cur;
  }

  return {
    name: handle.name,
    async list(dir) {
      const h = await dirHandle(dir);
      const out: DirEntry[] = [];
      const iter = h as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>;
      };
      for await (const [name, entry] of iter.entries()) {
        if (entry.kind === 'directory') {
          dirs.set(dir ? `${dir}/${name}` : name, entry as FileSystemDirectoryHandle);
          out.push({ name, kind: 'dir', size: 0 });
        } else {
          // Arquivo travado ou sem permissão: entra com tamanho 0 e a leitura o marca como ilegível.
          let size = 0;
          try {
            size = (await (entry as FileSystemFileHandle).getFile()).size;
          } catch {
            // segue com 0
          }
          out.push({ name, kind: 'file', size });
        }
      }
      return out;
    },
    async read(path) {
      const slash = path.lastIndexOf('/');
      const parent = await dirHandle(slash === -1 ? '' : path.slice(0, slash));
      const fh = await parent.getFileHandle(path.slice(slash + 1));
      return (await fh.getFile()).text();
    },
  };
}
