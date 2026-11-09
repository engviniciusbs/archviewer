import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@archviewer/core-wasm';
import { Toolbar } from '../../src/components/Toolbar';
import { makeApi, readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Relógio falso só para setTimeout. O Testing Library só reconhece timers falsos do Jest e,
 * sem isso, espera para sempre por um setTimeout(0) congelado; o shim de `jest` resolve.
 */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const advance = (ms: number) => {
    vi.advanceTimersByTime(ms);
  };
  vi.stubGlobal('jest', { advanceTimersByTime: advance });
  return userEvent.setup({ advanceTimers: advance });
}

const hits: SearchHit[] = [
  { id: 2, kind: 'file', label: 'a.ts', path: 'src/a.ts', ancestors: [0, 1] },
  { id: 3, kind: 'file', label: 'b.ts', path: 'src/b.ts', ancestors: [0, 1] },
];

describe('Toolbar', () => {
  it('"Abrir projeto" é a única tecla primária', async () => {
    const { store } = await readyStore();
    const { container } = renderWith(store, <Toolbar />);
    const primaries = container.querySelectorAll('.key--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Open project');
  });

  it.each([
    ['Hide externals', 'hideExternals'],
    ['Hide type-only', 'hideTypeOnly'],
    ['Hide assets', 'hideAssets'],
    ['Cycles only', 'cyclesOnly'],
  ] as const)('a tecla "%s" alterna aria-pressed e chama setFilter', async (label, key) => {
    const { store } = await readyStore();
    const spy = vi.spyOn(store.getState(), 'setFilter');
    renderWith(store, <Toolbar />);
    const btn = screen.getByRole('button', { name: label });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(spy).toHaveBeenCalledWith(key, true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    expect(spy).toHaveBeenLastCalledWith(key, false);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('digitar na busca chama find depois de 150ms e lista os resultados', async () => {
    const api = makeApi({ hits });
    const { store } = await readyStore(api);
    const user = fakeTimers();
    renderWith(store, <Toolbar />);
    await user.type(screen.getByRole('combobox', { name: 'Search file or folder' }), 'ts');
    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(api.find).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(api.find).toHaveBeenCalledTimes(1);
    expect(api.find).toHaveBeenCalledWith('ts', 50);
    const list = screen.getByRole('listbox', { name: 'Search results' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('src/a.ts'),
      expect.stringContaining('src/b.ts'),
    ]);
    expect(store.getState().searchResults).toEqual({ query: 'ts', hits });
  });

  it('escolher um resultado chama reveal e limpa a busca', async () => {
    const api = makeApi({ hits });
    const { store } = await readyStore(api);
    const reveal = vi.fn(async () => {});
    store.setState({ reveal });
    const user = fakeTimers();
    renderWith(store, <Toolbar />);
    const input = screen.getByRole('combobox', { name: 'Search file or folder' });
    await user.type(input, 'b');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await user.click(screen.getByRole('option', { name: /src\/b\.ts/ }));
    expect(reveal).toHaveBeenCalledWith(hits[1]);
    expect(store.getState().searchResults).toBeNull();
    expect(input).toHaveValue('');
  });

  it('Enter escolhe o resultado ativo pelas setas', async () => {
    const api = makeApi({ hits });
    const { store } = await readyStore(api);
    const reveal = vi.fn(async () => {});
    store.setState({ reveal });
    const user = fakeTimers();
    renderWith(store, <Toolbar />);
    await user.type(screen.getByRole('combobox', { name: 'Search file or folder' }), 'ts');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(reveal).toHaveBeenCalledWith(hits[1]);
  });
});
