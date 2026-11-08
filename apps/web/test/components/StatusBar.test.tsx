import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatusBar, statusItems } from '../../src/components/StatusBar';
import { issues, makeApi, readyStore, renderWith, summary } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('statusItems', () => {
  it('formata com plural e pt-BR', () => {
    expect(
      statusItems({ ...summary(), unresolvedShown: 1, ignored: 0, elapsedMs: 412 }),
    ).toEqual(['8 arquivos', '12 arestas', '1 ciclo', '2 externos', '1 não resolvido', '0 ignorados', '0,4 s']);
  });

  it('usa o singular e separa milhares', () => {
    expect(
      statusItems({
        ...summary({ files: 1, edges: 1, cycles: 0, externals: 1 }),
        unresolvedShown: 2345,
        ignored: 1,
        elapsedMs: 12_340,
      }),
    ).toEqual(['1 arquivo', '1 aresta', '0 ciclos', '1 externo', '2.345 não resolvidos', '1 ignorado', '12,3 s']);
  });
});

async function setup(o: Parameters<typeof makeApi>[0] = {}) {
  const { store } = await readyStore(makeApi(o));
  store.setState({ elapsedMs: 412 });
  return store;
}

describe('StatusBar em ready', () => {
  it('mostra arquivos, arestas, ciclos, não resolvidos, ignorados e tempo', async () => {
    const store = await setup({ finish: { summary: summary({ skipped: 2 }) } });
    store.setState({ ingestSkipped: [{ path: 'big.js', reason: 'tooLarge' }] });
    renderWith(store, <StatusBar />);
    const bar = screen.getByRole('status');
    const items = within(bar).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['8 arquivos', '12 arestas', '1 ciclo', '2 externos', '1 não resolvido', '3 ignorados', '0,4 s']);
  });

  it('"não resolvidos" abre a lista com from, specifier e motivo traduzido', async () => {
    const store = await setup({
      finish: {
        summary: summary({ unresolved: 3 }),
        issues: issues({
          unresolved: [
            { from: 'src/a.ts', specifier: './missing', reason: 'notFound' },
            { from: 'src/a.ts', specifier: './logo.svg', reason: 'asset' },
            { from: 'src/b.ts', specifier: '@x/y', reason: 'unknownAlias' },
          ],
        }),
      },
    });
    renderWith(store, <StatusBar />);
    const btn = screen.getByRole('button', { name: '3 não resolvidos' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Imports não resolvidos' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['src/a.ts', './missing', 'não encontrado'],
      ['src/a.ts', './logo.svg', 'asset'],
      ['src/b.ts', '@x/y', 'alias desconhecido'],
    ]);
    await userEvent.click(btn);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('respeita hideAssets', async () => {
    const store = await setup({
      finish: {
        issues: issues({
          unresolved: [
            { from: 'src/a.ts', specifier: './missing', reason: 'notFound' },
            { from: 'src/a.ts', specifier: './logo.svg', reason: 'asset' },
          ],
        }),
      },
    });
    store.getState().setFilter('hideAssets', true);
    renderWith(store, <StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: '1 não resolvido' }));
    const table = screen.getByRole('table', { name: 'Imports não resolvidos' });
    expect(table).not.toHaveTextContent('./logo.svg');
    expect(table).toHaveTextContent('./missing');
  });

  it('lista os warnings', async () => {
    const store = await setup({
      finish: { issues: issues({ warnings: ['tsconfig.json inválido: alias ignorados'] }) },
    });
    renderWith(store, <StatusBar />);
    expect(screen.getByRole('list', { name: 'Avisos' })).toHaveTextContent('tsconfig.json inválido: alias ignorados');
  });
});
