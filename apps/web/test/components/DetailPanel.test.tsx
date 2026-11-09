import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail, SearchHit } from '@archviewer/core-wasm';
import { DetailPanel } from '../../src/components/DetailPanel';
import { memorySource } from '../../src/ingest/source';
import { makeApi, readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const fileDetail = (o: Partial<Extract<Detail, { kind: 'file' }>> = {}): Detail => ({
  kind: 'file',
  id: 2,
  path: 'src/a.ts',
  language: 'ts',
  loc: 42,
  exports: ['run', 'default'],
  imports: [
    { id: 3, path: 'src/b.ts', kind: 'static', specifiers: ['b'] },
    { id: 7, path: 'lib/util.ts', kind: 'static', specifiers: ['util'] },
  ],
  importedBy: [{ id: 3, path: 'src/b.ts', kind: 'static', specifiers: ['run'] }],
  unresolved: [],
  cycle: [],
  fanIn: 1,
  fanOut: 2,
  parseErrors: [],
  ...o,
});

async function setup(detail: Detail | null, selected: number | null = detail?.id ?? null, hits: SearchHit[] = []) {
  const api = makeApi({ hits });
  const source = memorySource('proj', {
    'src/a.ts': "import { b } from './b';\nimport { util } from '../lib/util';\n\nexport const run = () => b + util;\n",
    'src/b.ts': 'export const b = 1;\n',
  });
  const { store } = await readyStore(api, source);
  const select = vi.fn(async () => {});
  const reveal = vi.fn(async () => {});
  const toggle = vi.fn(async () => {});
  store.setState({ selected, detail, select, reveal, toggle });
  return { store, api, select, reveal, toggle };
}

describe('DetailPanel', () => {
  it('sem seleção mostra o estado vazio', async () => {
    const { store } = await setup(null);
    renderWith(store, <DetailPanel />);
    expect(screen.getByText('Select a node in the graph or the explorer')).toBeInTheDocument();
  });

  it('falha ao carregar mostra o erro em vez do esqueleto', async () => {
    const { store } = await setup(null, 2);
    store.setState({ detailError: 2 });
    renderWith(store, <DetailPanel />);
    expect(screen.getByText("Couldn't load the details")).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading details')).not.toBeInTheDocument();
  });

  it('falha de outro id não vale para a seleção atual', async () => {
    const { store } = await setup(null, 2);
    store.setState({ detailError: 3 });
    renderWith(store, <DetailPanel />);
    expect(screen.getByLabelText('Loading details')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the details")).not.toBeInTheDocument();
  });

  it('arquivo: caminho em mono e fan-in/fan-out como números', async () => {
    const { store } = await setup(fileDetail({ fanIn: 1234, fanOut: 2 }));
    renderWith(store, <DetailPanel />);
    expect(screen.getByRole('heading', { name: 'a.ts' })).toBeInTheDocument();
    const path = screen.getByText('src/a.ts', { selector: 'code' });
    expect(path).toHaveClass('mono');
    expect(screen.getByTestId('fan-in')).toHaveTextContent('1,234');
    expect(screen.getByTestId('fan-out')).toHaveTextContent('2');
    expect(screen.getByTestId('fan-in')).toHaveClass('figure');
  });

  it('import visível chama select; import oculto busca e chama reveal', async () => {
    const hidden: SearchHit = { id: 7, kind: 'file', label: 'util.ts', path: 'lib/util.ts', ancestors: [0, 4] };
    const { store, api, select, reveal } = await setup(fileDetail(), 2, [hidden]);
    renderWith(store, <DetailPanel />);
    const imports = screen.getByRole('list', { name: 'Imports' });
    await userEvent.click(within(imports).getByRole('button', { name: 'src/b.ts' }));
    expect(select).toHaveBeenCalledWith(3);
    await userEvent.click(within(imports).getByRole('button', { name: 'lib/util.ts' }));
    expect(api.find).toHaveBeenCalledWith('lib/util.ts', 50);
    expect(reveal).toHaveBeenCalledWith(hidden);
    const dependents = screen.getByRole('list', { name: 'Dependents' });
    await userEvent.click(within(dependents).getByRole('button', { name: 'src/b.ts' }));
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('erros de parse aparecem com linha:coluna', async () => {
    const { store } = await setup(fileDetail({ parseErrors: [{ message: 'Unexpected token', line: 3, column: 14 }] }));
    renderWith(store, <DetailPanel />);
    expect(screen.getByText('3:14')).toBeInTheDocument();
    expect(screen.getByText('Unexpected token')).toBeInTheDocument();
  });

  it('avisa quando o arquivo está num ciclo', async () => {
    const { store } = await setup(fileDetail());
    renderWith(store, <DetailPanel />);
    expect(screen.queryByText(/Part of a cycle/)).not.toBeInTheDocument();
    store.setState({ detail: fileDetail({ cycle: ['src/a.ts', 'src/b.ts', 'src/a.ts'] }) });
    expect(await screen.findByText(/Part of a cycle/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Cycle' })).toHaveTextContent('src/b.ts');
  });

  it('"Recolher pasta" aparece quando o pai é um grupo expandido que não é a raiz', async () => {
    const { store, toggle } = await setup(fileDetail());
    renderWith(store, <DetailPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse folder' }));
    expect(toggle).toHaveBeenCalledWith(1);
  });

  it('"Recolher pasta" não aparece para um filho direto da raiz', async () => {
    const lib: Detail = {
      kind: 'group',
      id: 4,
      path: 'lib',
      label: 'lib',
      groupKind: 'folder',
      fileCount: 3,
      loc: 120,
      inCycle: false,
      topOutgoing: [],
      topIncoming: [],
    };
    const { store } = await setup(lib);
    renderWith(store, <DetailPanel />);
    expect(screen.queryByRole('button', { name: 'Collapse folder' })).not.toBeInTheDocument();
  });

  it('grupo: fileCount, loc e as maiores dependências', async () => {
    const group: Detail = {
      kind: 'group',
      id: 4,
      path: 'lib',
      label: 'lib',
      groupKind: 'folder',
      fileCount: 3,
      loc: 1200,
      inCycle: false,
      topOutgoing: [{ id: 1, path: 'src', weight: 5 }],
      topIncoming: [{ id: 9, path: 'react', weight: 2 }],
    };
    const { store, select } = await setup(group);
    renderWith(store, <DetailPanel />);
    expect(screen.getByTestId('file-count')).toHaveTextContent('3');
    expect(screen.getByTestId('loc')).toHaveTextContent('1,200');
    const out = screen.getByRole('list', { name: 'Largest outgoing dependencies' });
    expect(out).toHaveTextContent('src');
    expect(out).toHaveTextContent('5');
    const inc = screen.getByRole('list', { name: 'Largest incoming dependencies' });
    await userEvent.click(within(inc).getByRole('button', { name: /react/ }));
    expect(select).toHaveBeenCalledWith(9);
  });

  it('externo: nome e importedBy', async () => {
    const ext: Detail = {
      kind: 'external',
      id: 9,
      name: 'react',
      importedBy: [{ id: 2, path: 'src/a.ts', kind: 'static', specifiers: ['useState'] }],
    };
    const { store, select } = await setup(ext);
    renderWith(store, <DetailPanel />);
    expect(screen.getByRole('heading', { name: 'react' })).toBeInTheDocument();
    const by = screen.getByRole('list', { name: 'Imported by' });
    await userEvent.click(within(by).getByRole('button', { name: 'src/a.ts' }));
    expect(select).toHaveBeenCalledWith(2);
  });
});
