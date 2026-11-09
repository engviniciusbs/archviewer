import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@archviewer/core-wasm';
import { StatusBar } from '../../src/components/StatusBar';
import { useLocaleStore } from '../../src/i18n/store';
import { deadCode, makeApi, readyStore, renderWith } from './helpers';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const hit: SearchHit = { id: 7, kind: 'file', label: 'old.ts', path: 'src/old.ts', ancestors: [0, 1] };

async function setup(o: Parameters<typeof deadCode>[0] = {}) {
  const { store } = await readyStore(makeApi({ hits: [hit], finish: { deadCode: deadCode(o) } }));
  const reveal = vi.fn(async () => {});
  store.setState({ reveal });
  renderWith(store, <StatusBar />);
  await userEvent.click(screen.getByRole('button', { name: '2 unused' }));
  return { store, reveal, region: screen.getByRole('region', { name: 'Unused code' }) };
}

describe('painel de código sem uso', () => {
  it('lista arquivos sem uso, só de testes e exports sem uso', async () => {
    const { region } = await setup();
    const rows = (name: string) =>
      within(within(region).getByRole('table', { name })).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows('Unused files')).toEqual(['src/old.ts', 'src/legacy/x.ts']);
    expect(rows('Used only by tests')).toEqual(['src/fixtures.ts']);
    expect(rows('Unused exports')).toEqual(['src/a.tshelper, default']);
    expect(within(region).queryByText(/nobody imports it/)).not.toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /Open an issue/ })).toHaveAttribute(
      'href',
      'https://github.com/engviniciusbs/archviewer/issues/new?template=bug_report.yml',
    );
  });

  it('clicar num caminho revela o nó', async () => {
    const { region, reveal } = await setup();
    await userEvent.click(within(region).getByRole('button', { name: 'src/old.ts' }));
    expect(reveal).toHaveBeenCalledWith(hit);
  });

  it('avisa quando caiu no fallback', async () => {
    const { region } = await setup({ fallback: true });
    expect(within(region).getByText(/nobody imports it/)).toBeInTheDocument();
  });

  it('segue o idioma', async () => {
    await setup();
    act(() => useLocaleStore.getState().setLocale('pt-BR'));
    expect(screen.getByRole('region', { name: 'Código sem uso' })).toBeInTheDocument();
  });
});
