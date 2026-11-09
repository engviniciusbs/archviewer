import type { GraphExport } from '@archviewer/core-wasm';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportMenu } from '../../src/components/ExportMenu';
import { registerSceneSource } from '../../src/export/scene';
import { useLocaleStore } from '../../src/i18n/store';
import { makeApi, readyStore, renderWith } from './helpers';

const graphExport = { version: 1, project: 'proj', files: [] } as unknown as GraphExport;

let downloads: { name: string; blob: Blob }[];
let lastBlob: Blob | null;
let unregister: () => void;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  downloads = [];
  lastBlob = null;
  URL.createObjectURL = vi.fn((b: Blob) => {
    lastBlob = b;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: lastBlob! });
  });
  unregister = registerSceneSource(() => ({
    nodes: [{ x: 0, y: 0, size: 4, color: 'rgb(0, 0, 0)', label: 'a.ts', kind: 'file' }],
    edges: [],
  }));
});

afterEach(() => {
  unregister();
  vi.restoreAllMocks();
});

async function setup() {
  const { store } = await readyStore(makeApi({ exportGraph: graphExport }));
  const user = userEvent.setup();
  renderWith(store, <ExportMenu />);
  return { store, user };
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Export' }));
  return screen.getByRole('menu');
};

describe('ExportMenu', () => {
  it('é um menu button com cinco itens', async () => {
    const { user } = await setup();
    const btn = screen.getByRole('button', { name: 'Export' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    const menu = await open(user);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'PNG image',
      'SVG image',
      'Mermaid diagram',
      'Full graph (JSON)',
      'README badge',
    ]);
    expect(menu).toBeVisible();
  });

  it('setas movem o foco; Esc fecha e devolve o foco ao botão', async () => {
    const { user } = await setup();
    await open(user);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[4]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toHaveFocus();
  });

  it('JSON baixa o grafo completo com o nome do projeto', async () => {
    const { user } = await setup();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Full graph (JSON)' }));
    expect(downloads.map((d) => d.name)).toEqual(['proj-archviewer.json']);
    expect(JSON.parse(await downloads[0]!.blob.text())).toEqual(graphExport);
    expect(await screen.findByText('Downloaded proj-archviewer.json')).toHaveAttribute('aria-live', 'polite');
  });

  it('SVG baixa a cena registrada', async () => {
    const { user } = await setup();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'SVG image' }));
    expect(downloads[0]!.name).toBe('proj-archviewer.svg');
    expect(await downloads[0]!.blob.text()).toMatch(/^<svg[^>]*>.*a\.ts/);
  });

  it('Mermaid vai para a área de transferência', async () => {
    const { user } = await setup();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Mermaid diagram' }));
    expect(await navigator.clipboard.readText()).toMatch(/^flowchart LR/);
    expect(await screen.findByText('Copied to the clipboard')).toBeInTheDocument();
  });

  it('badge copia o snippet com as contagens', async () => {
    const { user } = await setup();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'README badge' }));
    expect(await navigator.clipboard.readText()).toContain('architecture: 8 files · 1 cycle');
  });

  it('clipboard recusado abre o diálogo de cópia manual', async () => {
    const { user } = await setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Mermaid diagram' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy manually' });
    expect(dialog).toBeVisible();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/^flowchart LR/);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem clipboard no navegador também abre o diálogo', async () => {
    const { user } = await setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'README badge' }));
    expect(await screen.findByRole('dialog', { name: 'Copy manually' })).toBeVisible();
  });

  it('visão vazia desabilita imagem e Mermaid, mas não o JSON', async () => {
    const { store, user } = await setup();
    act(() => store.getState().setFilter('cyclesOnly', true));
    await open(user);
    for (const name of ['PNG image', 'SVG image', 'Mermaid diagram']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByRole('menuitem', { name: 'Full graph (JSON)' })).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('menuitem', { name: 'PNG image' }));
    expect(downloads).toEqual([]);
  });

  it('sem canvas registrado, imagens ficam desabilitadas com o motivo', async () => {
    unregister();
    const { user } = await setup();
    await open(user);
    const svg = screen.getByRole('menuitem', { name: 'SVG image' });
    expect(svg).toHaveAttribute('aria-disabled', 'true');
    expect(svg).toHaveAccessibleDescription('The graph canvas is unavailable');
  });

  it('segue o idioma ativo', async () => {
    await setup();
    act(() => useLocaleStore.getState().setLocale('pt-BR'));
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument();
  });
});
