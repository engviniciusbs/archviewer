import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { pickDirectory } from '../../src/ingest/pick';
import { memorySource } from '../../src/ingest/source';
import { makeApi, readyStore, renderWith, storeWith } from './helpers';

vi.mock('../../src/renderer/GraphCanvas', () => ({
  GraphCanvas: () => <div data-testid="graph-canvas-stub" />,
}));
vi.mock('../../src/ingest/pick', () => ({ pickDirectory: vi.fn() }));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(pickDirectory).mockReset();
});

describe('App', () => {
  it("phase 'empty' mostra a EmptyScreen com \"Abrir projeto\" e a nota de navegadores", () => {
    renderWith(storeWith(), <App />);
    expect(screen.getByRole('heading', { level: 1, name: 'ArchViewer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir projeto' })).toHaveClass('key--primary');
    expect(
      screen.getByText(
        'Funciona melhor no Chrome e no Edge. No Firefox e no Safari, o ArchViewer usa o seletor de arquivos.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('graph-canvas-stub')).not.toBeInTheDocument();
  });

  it('"Abrir projeto" escolhe a pasta e chama openProject; cancelar não faz nada', async () => {
    const store = storeWith();
    const openProject = vi.fn(async () => {});
    store.setState({ openProject });
    const source = memorySource('p', { 'a.ts': '' });
    vi.mocked(pickDirectory).mockResolvedValueOnce(null).mockResolvedValueOnce({ source, fallback: true });
    renderWith(store, <App />);
    const btn = screen.getByRole('button', { name: 'Abrir projeto' });
    await userEvent.click(btn);
    expect(openProject).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(openProject).toHaveBeenCalledWith(source, true);
  });

  it('uma falha ao abrir a pasta aparece na tela', async () => {
    vi.mocked(pickDirectory).mockRejectedValueOnce(new Error('acesso negado'));
    renderWith(storeWith(), <App />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir projeto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('acesso negado');
  });

  it("phase 'error' mostra a mensagem e \"Recarregar\" chama location.reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const store = storeWith();
    store.setState({ phase: 'error', error: 'o worker de análise parou' });
    renderWith(store, <App />);
    expect(screen.getByRole('heading', { name: 'Algo deu errado na análise' })).toBeInTheDocument();
    expect(screen.getByText('o worker de análise parou')).toHaveClass('mono');
    const btn = screen.getByRole('button', { name: 'Recarregar' });
    expect(btn).toHaveClass('key--primary');
    await userEvent.click(btn);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('fases de leitura mostram o placeholder com o progresso', () => {
    const store = storeWith();
    store.setState({ phase: 'reading', progress: { read: 1234, total: 5678 } });
    renderWith(store, <App />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Lendo projeto…');
    expect(status).toHaveTextContent('1.234 de 5.678 arquivos');
  });

  it('ready mostra o shell com toolbar, explorador, grafo, detalhes e status', async () => {
    const { store } = await readyStore(makeApi());
    renderWith(store, <App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByTestId('graph-canvas-stub')).toBeInTheDocument();
    expect(screen.getByText('Selecione um nó no grafo ou no explorador')).toBeInTheDocument();
    expect(screen.getByText('8 arquivos')).toBeInTheDocument();
    expect(screen.queryByText(/Seu navegador não tem acesso direto/)).not.toBeInTheDocument();
  });

  it('com fallback: true aparece o aviso discreto', async () => {
    const { store } = await readyStore(makeApi());
    store.setState({ fallback: true });
    renderWith(store, <App />);
    expect(
      screen.getByText('Seu navegador não tem acesso direto a pastas; usando o seletor de arquivos.'),
    ).toBeInTheDocument();
  });
});
