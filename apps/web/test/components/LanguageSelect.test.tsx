import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyScreen } from '../../src/components/EmptyScreen';
import { Toolbar } from '../../src/components/Toolbar';
import { readyStore, renderWith } from './helpers';

afterEach(() => localStorage.clear());

describe('seletor de idioma', () => {
  it('na barra superior, troca a interface e o <html lang>', async () => {
    const { store } = await readyStore();
    renderWith(store, <Toolbar />);
    expect(screen.getByRole('button', { name: 'Open project' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Português');
    expect(screen.getByRole('button', { name: 'Abrir projeto' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Idioma' })).toHaveValue('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('aparece na tela inicial com os idiomas registrados', () => {
    render(<EmptyScreen />);
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['English', 'Português']);
  });
});
