import { fromDirectoryHandle, fromFileList, type DirSource } from './source';

type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

/** Abre o seletor de pasta. Devolve null se o usuário cancelar. */
export async function pickDirectory(): Promise<{ source: DirSource; fallback: boolean } | null> {
  const w = window as PickerWindow;
  if (w.showDirectoryPicker) {
    try {
      const handle = await w.showDirectoryPicker({ mode: 'read' });
      return { source: fromDirectoryHandle(handle), fallback: false };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => {
      resolve(
        input.files && input.files.length > 0
          ? { source: fromFileList(input.files), fallback: true }
          : null,
      );
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
