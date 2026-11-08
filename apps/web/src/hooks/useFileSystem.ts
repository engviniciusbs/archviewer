import { useState, useCallback } from 'react';
import type { FileEntry } from '../types/graph';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  'coverage', '.turbo', '.cache', '__pycache__', '.svelte-kit',
]);

const PARSEABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
]);

function isParseable(name: string): boolean {
  const lower = name.toLowerCase();
  return Array.from(PARSEABLE_EXTENSIONS).some(ext => lower.endsWith(ext));
}

function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith('.');
}

export function useFileSystem() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [directoryName, setDirectoryName] = useState<string | null>(null);

  const openDirectory = useCallback(async () => {
    setIsLoading(true);
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
        setDirectoryName(handle.name);
        const entries = await readDirectoryHandle(handle, '');
        setFiles(entries);
      } else {
        const entries = await readViaInput();
        if (entries.length > 0) {
          const firstPath = entries[0].path;
          const rootName = firstPath.split('/')[0] ?? 'project';
          setDirectoryName(rootName);
        }
        setFiles(entries);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to open directory:', error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { files, isLoading, openDirectory, directoryName };
}

async function readDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  basePath: string,
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  for await (const [name, entry] of (handle as any).entries()) {
    const path = basePath ? `${basePath}/${name}` : name;

    if (entry.kind === 'directory') {
      if (!isIgnoredDir(name)) {
        const subEntries = await readDirectoryHandle(entry, path);
        entries.push(...subEntries);
      }
    } else if (entry.kind === 'file' && isParseable(name)) {
      try {
        const file: File = await entry.getFile();
        const content = await file.text();
        entries.push({ path, content });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return entries;
}

function readViaInput(): Promise<FileEntry[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');

    input.addEventListener('change', async () => {
      const fileList = input.files;
      if (!fileList) { resolve([]); return; }

      const entries: FileEntry[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const path = file.webkitRelativePath || file.name;
        const parts = path.split('/');
        if (parts.some(part => isIgnoredDir(part))) continue;
        if (!isParseable(file.name)) continue;

        try {
          const content = await file.text();
          entries.push({ path, content });
        } catch {
          // Skip unreadable files
        }
      }
      resolve(entries);
    });

    input.click();
  });
}
