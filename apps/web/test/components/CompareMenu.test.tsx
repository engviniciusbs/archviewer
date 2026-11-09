import type { GraphExport } from '@archviewer/core-wasm';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CompareMenu } from '../../src/components/CompareMenu';
import { g } from '../compare/helpers';
import { makeApi, readyStore, renderWith } from './helpers';

const current = { ...g({ files: ['src/a.ts', 'src/new.ts'] }), project: 'proj' } as GraphExport;
const base = { ...g({ files: ['src/a.ts'] }), project: 'proj' } as GraphExport;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

async function setup() {
  const { store } = await readyStore(makeApi({ exportGraph: current }));
  const user = userEvent.setup();
  const view = renderWith(store, <CompareMenu />);
  return { store, user, view };
}

function upload(container: HTMLElement, text: string, name: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('CompareMenu', () => {
  it('menu com as duas fontes; "Stop comparing" só com comparação', async () => {
    const { user } = await setup();
    const btn = screen.getByRole('button', { name: 'Compare' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(btn);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'With an exported JSON…',
      'With another folder…',
    ]);
  });

  it('JSON válido liga a comparação e mostra a pílula; o × desliga', async () => {
    const { store, user, view } = await setup();
    upload(view.container, JSON.stringify(base), 'base.json');
    expect(await screen.findByText('Comparing with base.json')).toBeInTheDocument();
    expect(store.getState().comparison?.diff.filesAdded).toEqual(['src/new.ts']);
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(screen.getByRole('menuitem', { name: 'Stop comparing' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Stop comparing' }));
    expect(store.getState().comparison).toBeNull();
    expect(screen.queryByText('Comparing with base.json')).not.toBeInTheDocument();
  });

  it('arquivo inválido mostra a mensagem', async () => {
    const { view } = await setup();
    upload(view.container, '{"nope":1}', 'x.json');
    expect(await screen.findByText('This file is not an ArchViewer graph export')).toBeInTheDocument();
  });

  it('avisa quando o export veio de outro projeto', async () => {
    const { view } = await setup();
    upload(view.container, JSON.stringify({ ...base, project: 'other' }), 'o.json');
    expect(await screen.findByText('Exported from another project (other)')).toBeInTheDocument();
  });
});
