import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { useLocaleStore } from '../src/i18n/store';

// Sem `globals: true`, o Testing Library não desmonta sozinho entre os testes.
afterEach(() => {
  cleanup();
});

// Os testes conferem os textos em inglês; quem testa outro idioma troca dentro do teste.
beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});
