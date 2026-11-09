import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@archviewer/core-wasm';
import { diffGraphs, type GraphDiff } from '../../src/compare/diff';
import { StatusBar } from '../../src/components/StatusBar';
import { useLocaleStore } from '../../src/i18n/store';
import { g } from '../compare/helpers';
import { makeApi, readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const hit: SearchHit = { id: 7, kind: 'file', label: 'new.ts', path: 'src/new.ts', ancestors: [0, 1] };

const sample = diffGraphs(
  g({ files: ['src/a.ts', 'src/old.ts'], externals: ['lodash'], edges: [['src/a.ts', 'lodash']] }),
  g({ files: ['src/a.ts', 'src/new.ts'], externals: ['react'], edges: [['src/a.ts', 'react']] }),
);

async function setup(diff: GraphDiff = sample) {
  const { store } = await readyStore(makeApi({ hits: [hit] }));
  const reveal = vi.fn(async () => {});
  store.setState({ reveal, comparison: { label: 'base.json', diff, warning: null, baseProject: 'p' } });
  const user = userEvent.setup();
  renderWith(store, <StatusBar />);
  return { store, reveal, user };
}

describe('painel de mudanças', () => {
  it('o item da barra abre a região com as seções que têm itens', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: '6 changes' }));
    const region = screen.getByRole('region', { name: 'Changes' });
    const list = (name: string) => within(region).getByRole('list', { name });
    expect(list('Added files')).toHaveTextContent('src/new.ts');
    expect(list('Removed files')).toHaveTextContent('src/old.ts');
    expect(list('New packages')).toHaveTextContent('react');
    expect(list('Removed packages')).toHaveTextContent('lodash');
    expect(list('New dependencies')).toHaveTextContent('src → react');
    expect(within(region).queryByRole('list', { name: 'New cycles' })).not.toBeInTheDocument();
  });

  it('arquivo novo é um botão que revela o nó', async () => {
    const { user, reveal } = await setup();
    await user.click(screen.getByRole('button', { name: '6 changes' }));
    await user.click(screen.getByRole('button', { name: 'src/new.ts' }));
    expect(reveal).toHaveBeenCalledWith(hit);
  });

  it('listas longas param em 200 e contam o resto', async () => {
    const files = Array.from({ length: 205 }, (_, i) => `src/f${String(i).padStart(3, '0')}.ts`);
    const { user } = await setup(diffGraphs(g({ files: [] }), g({ files })));
    await user.click(screen.getByRole('button', { name: '205 changes' }));
    const list = screen.getByRole('list', { name: 'Added files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(201);
    expect(list).toHaveTextContent('and 5 more');
  });

  it('sem mudanças diz isso', async () => {
    const same = g();
    const { user } = await setup(diffGraphs(same, same));
    await user.click(screen.getByRole('button', { name: '0 changes' }));
    expect(screen.getByText('No changes between the two versions.')).toBeInTheDocument();
  });

  it('segue o idioma', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: '6 changes' }));
    act(() => useLocaleStore.getState().setLocale('pt-BR'));
    expect(screen.getByRole('region', { name: 'Mudanças' })).toBeInTheDocument();
  });

  it('sem comparação, o item não existe', async () => {
    const { store } = await setup();
    act(() => store.setState({ comparison: null }));
    expect(screen.queryByRole('button', { name: /changes/ })).not.toBeInTheDocument();
  });
});
