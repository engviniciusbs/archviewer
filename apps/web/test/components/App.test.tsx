import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { pickDirectory } from '../../src/ingest/pick';
import { memorySource } from '../../src/ingest/source';
import { makeApi, readyStore, renderWith, storeWith } from './helpers';

const canvas = vi.hoisted(() => ({ throws: false }));
vi.mock('../../src/renderer/GraphCanvas', () => ({
  GraphCanvas: () => {
    if (canvas.throws) throw new Error('WebGL indisponível');
    return <div data-testid="graph-canvas-stub" />;
  },
}));
vi.mock('../../src/ingest/pick', () => ({ pickDirectory: vi.fn() }));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  canvas.throws = false;
  vi.unstubAllGlobals();
  vi.mocked(pickDirectory).mockReset();
});

describe('App', () => {
  it("phase 'empty' mostra a EmptyScreen com \"Abrir projeto\" e a nota de navegadores", () => {
    renderWith(storeWith(), <App />);
    expect(screen.getByRole('heading', { level: 1, name: 'ArchViewer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project' })).toHaveClass('key--primary');
    expect(
      screen.getByText(
        'Works best in Chrome and Edge. In Firefox and Safari, ArchViewer uses the file picker.',
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
    const btn = screen.getByRole('button', { name: 'Open project' });
    await userEvent.click(btn);
    expect(openProject).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(openProject).toHaveBeenCalledWith(source, true);
  });

  it('uma falha ao abrir a pasta aparece na tela', async () => {
    vi.mocked(pickDirectory).mockRejectedValueOnce(new Error('acesso negado'));
    renderWith(storeWith(), <App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('acesso negado');
  });

  it("phase 'error' mostra a mensagem e \"Recarregar\" chama location.reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const store = storeWith();
    store.setState({ phase: 'error', error: 'analysis worker stopped' });
    renderWith(store, <App />);
    expect(screen.getByRole('heading', { name: 'Something went wrong in the analysis' })).toBeInTheDocument();
    expect(screen.getByText('analysis worker stopped')).toHaveClass('mono');
    const btn = screen.getByRole('button', { name: 'Reload' });
    expect(btn).toHaveClass('key--primary');
    await userEvent.click(btn);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('fases de leitura mostram a LoadingScreen com o progresso', () => {
    const store = storeWith();
    store.setState({ phase: 'reading', progress: { read: 1234, total: 5678 } });
    renderWith(store, <App />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Reading 1,234 of 5,678 files');
  });

  it('ready mostra o shell com toolbar, explorador, grafo, detalhes e status', async () => {
    const { store } = await readyStore(makeApi());
    renderWith(store, <App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByTestId('graph-canvas-stub')).toBeInTheDocument();
    expect(screen.getByText('Select a node in the graph or the explorer')).toBeInTheDocument();
    expect(screen.getByText('8 files')).toBeInTheDocument();
    expect(screen.queryByText(/access folders directly/)).not.toBeInTheDocument();
  });

  it('com fallback: true aparece o aviso discreto', async () => {
    const { store } = await readyStore(makeApi());
    store.setState({ fallback: true });
    renderWith(store, <App />);
    expect(
      screen.getByText("Your browser can't access folders directly; using the file picker."),
    ).toBeInTheDocument();
  });

  it('se o grafo não consegue iniciar (sem WebGL), mostra o erro com Recarregar e mantém o resto', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    canvas.throws = true;
    const { store } = await readyStore(makeApi());
    renderWith(store, <App />);
    const graph = screen.getByRole('main', { name: 'Dependency graph' });
    expect(within(graph).getByRole('alert')).toHaveTextContent(
      "Your browser couldn't start WebGL, which is needed to draw the graph.",
    );
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    await userEvent.click(within(graph).getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole('tree')).toBeInTheDocument();
    quiet.mockRestore();
  });
});
