import type { Warning } from '@archviewer/core-wasm';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatusBar, statusItems } from '../../src/components/StatusBar';
import { messagesFor } from '../../src/i18n/locales';
import { useLocaleStore } from '../../src/i18n/store';
import { issues, makeApi, readyStore, renderWith, summary } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('statusItems', () => {
  it('formata com plural em inglês', () => {
    expect(
      statusItems({ ...summary(), unresolvedShown: 1, ignored: 0, elapsedMs: 412 }, messagesFor('en')),
    ).toEqual(['8 files', '12 edges', '1 cycle', '2 externals', '1 unresolved', '0 ignored', '0.4 s']);
  });

  it('formata com plural e pt-BR', () => {
    expect(
      statusItems({ ...summary(), unresolvedShown: 1, ignored: 0, elapsedMs: 412 }, messagesFor('pt-BR')),
    ).toEqual(['8 arquivos', '12 arestas', '1 ciclo', '2 externos', '1 não resolvido', '0 ignorados', '0,4 s']);
  });

  it('usa o singular e separa milhares', () => {
    expect(
      statusItems({
        ...summary({ files: 1, edges: 1, cycles: 0, externals: 1 }),
        unresolvedShown: 2345,
        ignored: 1,
        elapsedMs: 12_340,
      }, messagesFor('pt-BR')),
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
    expect(items).toEqual(['8 files', '12 edges', '1 cycle', '2 externals', '1 unresolved', '3 ignored', '0.4 s']);
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
    const btn = screen.getByRole('button', { name: '3 unresolved' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Unresolved imports' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['src/a.ts', './missing', 'not found'],
      ['src/a.ts', './logo.svg', 'asset'],
      ['src/b.ts', '@x/y', 'unknown alias'],
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
    await userEvent.click(screen.getByRole('button', { name: '1 unresolved' }));
    const table = screen.getByRole('table', { name: 'Unresolved imports' });
    expect(table).not.toHaveTextContent('./logo.svg');
    expect(table).toHaveTextContent('./missing');
  });

  it('"ignorados" abre a lista com caminho e motivo, do core e da leitura', async () => {
    const store = await setup({
      finish: {
        summary: summary({ skipped: 2 }),
        issues: issues({
          skipped: [
            { path: 'dist/huge.js', reason: 'tooLarge' },
            { path: 'docs/a.md', reason: 'notIngestible' },
          ],
        }),
      },
    });
    store.setState({
      ingestSkipped: [
        { path: 'locked', reason: 'unreadable' },
        { path: 'big.js', reason: 'tooLarge' },
      ],
    });
    renderWith(store, <StatusBar />);
    const btn = screen.getByRole('button', { name: '4 ignored' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const rows = within(screen.getByRole('table', { name: 'Ignored files' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['dist/huge.js', 'larger than 2 MB'],
      ['docs/a.md', 'not supported'],
      ['locked', 'unreadable'],
      ['big.js', 'larger than 2 MB'],
    ]);
    // Abrir os não resolvidos fecha os ignorados.
    await userEvent.click(screen.getByRole('button', { name: '1 unresolved' }));
    expect(screen.queryByRole('table', { name: 'Ignored files' })).not.toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    await userEvent.click(within(screen.getByRole('region', { name: 'Ignored' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Ignored' })).not.toBeInTheDocument();
  });

  it('sem ignorados, a lista explica que nada ficou de fora', async () => {
    const store = await setup();
    renderWith(store, <StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: '0 ignored' }));
    expect(screen.getByRole('region', { name: 'Ignored' })).toHaveTextContent('No file was left out of the analysis.');
  });

  it('traduz os avisos estruturados do núcleo', async () => {
    const store = await setup({
      finish: { issues: issues({ warnings: [{ code: 'invalidTsconfig', subject: 'tsconfig.json' }] }) },
    });
    renderWith(store, <StatusBar />);
    expect(screen.getByRole('list', { name: 'Warnings' })).toHaveTextContent('invalid tsconfig: tsconfig.json');
  });

  it('mostra code: subject para um código que a interface não conhece', async () => {
    const unknown = { code: 'brandNew', subject: 'x' } as unknown as Warning;
    const store = await setup({ finish: { issues: issues({ warnings: [unknown] }) } });
    renderWith(store, <StatusBar />);
    expect(screen.getByRole('list', { name: 'Warnings' })).toHaveTextContent('brandNew: x');
  });

  it('troca de idioma com o painel aberto sem fechá-lo', async () => {
    const store = await setup({
      finish: {
        summary: summary({ files: 1234 }),
        issues: issues({ unresolved: [{ from: 'src/a.ts', specifier: './missing', reason: 'notFound' }] }),
      },
    });
    renderWith(store, <StatusBar />);
    await userEvent.click(screen.getByRole('button', { name: '1 unresolved' }));
    expect(screen.getByRole('table', { name: 'Unresolved imports' })).toBeInTheDocument();
    act(() => useLocaleStore.getState().setLocale('pt-BR'));
    expect(screen.getByRole('table', { name: 'Imports não resolvidos' })).toHaveTextContent('não encontrado');
    expect(screen.getByRole('status')).toHaveTextContent('1.234 arquivos');
  });
});
