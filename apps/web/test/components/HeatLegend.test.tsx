import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColorBySelect } from '../../src/components/ColorBySelect';
import { HeatLegend } from '../../src/components/HeatLegend';
import { useLocaleStore } from '../../src/i18n/store';
import { readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

async function withLoc() {
  const { store } = await readyStore();
  const graph = store.getState().graph;
  store.setState({
    graph: {
      ...graph,
      nodes: graph.nodes.map((n, i) => ({ ...n, metrics: { ...n.metrics, loc: i + 1 } })),
    },
  });
  return store;
}

describe('HeatLegend', () => {
  it('não aparece sem heatmap', async () => {
    const store = await withLoc();
    const { container } = renderWith(store, <HeatLegend />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra o título e as faixas da métrica', async () => {
    const store = await withLoc();
    store.setState({ colorBy: 'loc' });
    renderWith(store, <HeatLegend />);
    const legend = screen.getByRole('group', { name: 'Lines' });
    expect(legend).toBeVisible();
    expect(legend.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('segue o idioma', async () => {
    const store = await withLoc();
    store.setState({ colorBy: 'unused' });
    renderWith(store, <HeatLegend />);
    act(() => useLocaleStore.getState().setLocale('pt-BR'));
    expect(screen.getByRole('group', { name: 'Sem uso' })).toHaveTextContent('Só usado por testes');
  });
});

describe('ColorBySelect', () => {
  it('troca o modo no store e na URL', async () => {
    const store = await withLoc();
    renderWith(store, <ColorBySelect />);
    const select = screen.getByRole('combobox', { name: 'Color by' });
    expect(select).toHaveValue('none');
    await userEvent.selectOptions(select, 'fanIn');
    expect(store.getState().colorBy).toBe('fanIn');
    expect(window.location.search).toBe('?color=fanIn');
  });
});
