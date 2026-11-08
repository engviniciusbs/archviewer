export type DirEntry = { name: string; kind: 'file' | 'dir'; size: number };

export interface DirSource {
  name: string;
  list(dir: string): Promise<DirEntry[]>;
  read(path: string): Promise<string>;
}

/**
 * Indexa uma vez os filhos diretos de cada pasta a partir de caminhos -> tamanho, para que
 * `list` não percorra o índice inteiro a cada chamada (o seletor inclui node_modules).
 */
function buildDirIndex(index: Iterable<[string, number]>): (dir: string) => DirEntry[] {
  const dirs = new Map<string, Map<string, DirEntry>>();
  const child = (dir: string, entry: DirEntry) => {
    let kids = dirs.get(dir);
    if (!kids) dirs.set(dir, (kids = new Map()));
    if (!kids.has(entry.name)) kids.set(entry.name, entry);
  };
  for (const [path, size] of index) {
    const segs = path.split('/');
    let dir = '';
    for (let i = 0; i < segs.length - 1; i++) {
      child(dir, { name: segs[i]!, kind: 'dir', size: 0 });
      dir = dir ? `${dir}/${segs[i]}` : segs[i]!;
    }
    child(dir, { name: segs[segs.length - 1]!, kind: 'file', size });
  }
  // Cópia: quem chama (scan) ordena a lista no lugar.
  return (dir) => [...(dirs.get(dir)?.values() ?? [])];
}

export function memorySource(name: string, files: Record<string, string>): DirSource {
  const enc = new TextEncoder();
  const index = new Map<string, number>();
  for (const [path, content] of Object.entries(files)) index.set(path, enc.encode(content).length);
  const list = buildDirIndex(index);
  return {
    name,
    list: async (dir) => list(dir),
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
  const list = buildDirIndex(index);
  return {
    name: rootName,
    list: async (dir) => list(dir),
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
