import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@archviewer/core-wasm';
import { Explorer } from '../../src/components/Explorer';
import { readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

async function setup() {
  const { store } = await readyStore();
  const toggle = vi.fn(async () => {});
  const select = vi.fn(async () => {});
  const reveal = vi.fn(async () => {});
  store.setState({ toggle, select, reveal });
  return { store, toggle, select, reveal };
}

describe('Explorer', () => {
  it('renderiza explorerRows como tree, com aria-expanded nos grupos', async () => {
    const { store } = await setup();
    renderWith(store, <Explorer />);
    const tree = screen.getByRole('tree');
    const items = within(tree).getAllByRole('treeitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('lib'),
      expect.stringContaining('src'),
      expect.stringContaining('a.ts'),
      expect.stringContaining('b.ts'),
      expect.stringContaining('react'),
    ]);
    const [lib, src, a] = items;
    expect(lib).toHaveAttribute('aria-expanded', 'false');
    expect(src).toHaveAttribute('aria-expanded', 'true');
    expect(a).not.toHaveAttribute('aria-expanded');
    expect(a).toHaveAttribute('aria-level', '2');
    expect(src).toHaveAttribute('aria-level', '1');
  });

  it('clicar num grupo expansível chama toggle e clicar numa linha chama select', async () => {
    const { store, toggle, select } = await setup();
    renderWith(store, <Explorer />);
    await userEvent.click(screen.getByRole('treeitem', { name: /lib/ }));
    expect(toggle).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole('treeitem', { name: /a\.ts/ }));
    expect(select).toHaveBeenCalledWith(2);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('a linha selecionada tem aria-selected="true"', async () => {
    const { store } = await setup();
    store.setState({ selected: 3 });
    renderWith(store, <Explorer />);
    expect(screen.getByRole('treeitem', { name: /b\.ts/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: /a\.ts/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('as setas movem o foco e a direita expande um grupo', async () => {
    const { store, toggle, select } = await setup();
    renderWith(store, <Explorer />);
    const lib = screen.getByRole('treeitem', { name: /lib/ });
    lib.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(toggle).toHaveBeenCalledWith(4);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(select).toHaveBeenCalledWith(2);
  });

  it('com uma busca ativa, mostra os resultados no lugar da árvore', async () => {
    const { store, reveal } = await setup();
    const hit: SearchHit = { id: 3, kind: 'file', label: 'b.ts', path: 'src/b.ts', ancestors: [0, 1] };
    store.getState().setSearchResults({ query: 'b', hits: [hit] });
    renderWith(store, <Explorer />);
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    const results = screen.getByRole('list', { name: 'Results for “b”' });
    await userEvent.click(within(results).getByRole('button', { name: /src\/b\.ts/ }));
    expect(reveal).toHaveBeenCalledWith(hit);
    expect(store.getState().searchResults).toBeNull();
  });

  it('busca sem resultados diz o que procurou', async () => {
    const { store } = await setup();
    store.getState().setSearchResults({ query: 'zzz', hits: [] });
    renderWith(store, <Explorer />);
    expect(screen.getByText('Nothing found for “zzz”.')).toBeInTheDocument();
  });
});
