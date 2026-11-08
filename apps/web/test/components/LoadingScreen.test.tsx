import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { renderWith, storeWith } from './helpers';

describe('LoadingScreen', () => {
  it('scanning mostra "Procurando arquivos…"', () => {
    const store = storeWith();
    store.setState({ phase: 'scanning' });
    renderWith(store, <LoadingScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Procurando arquivos…');
  });

  it('reading mostra a contagem pt-BR e a barra de progresso', () => {
    const store = storeWith();
    store.setState({ phase: 'reading', progress: { read: 1234, total: 5678 } });
    renderWith(store, <LoadingScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Lendo 1.234 de 5.678 arquivos');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1234');
    expect(bar).toHaveAttribute('aria-valuemax', '5678');
  });

  it('analyzing mostra "Analisando imports…"', () => {
    const store = storeWith();
    store.setState({ phase: 'analyzing' });
    renderWith(store, <LoadingScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Analisando imports…');
  });

  it('"Cancelar" chama cancel', async () => {
    const store = storeWith();
    const cancel = vi.fn();
    store.setState({ phase: 'reading', progress: { read: 1, total: 2 }, cancel });
    renderWith(store, <LoadingScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('confirm pergunta e "Ler projeto" chama confirmLarge(true)', async () => {
    const store = storeWith();
    const confirmLarge = vi.fn();
    store.setState({ phase: 'confirm', pendingCount: 12345, confirmLarge });
    renderWith(store, <LoadingScreen />);
    expect(screen.getByText('Este projeto tem 12.345 arquivos de código. Ler mesmo assim?')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Ler projeto' });
    expect(btn).toHaveClass('key--primary');
    await userEvent.click(btn);
    expect(confirmLarge).toHaveBeenCalledWith(true);
  });
});
