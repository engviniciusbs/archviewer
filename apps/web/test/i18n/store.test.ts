import { afterEach, describe, expect, it } from 'vitest';
import { messagesFor } from '../../src/i18n/locales';
import { useLocaleStore } from '../../src/i18n/store';

describe('useLocaleStore', () => {
  afterEach(() => localStorage.clear());
  it('setLocale troca o idioma, salva e ajusta <html lang>', () => {
    useLocaleStore.getState().setLocale('pt-BR');
    expect(useLocaleStore.getState().locale).toBe('pt-BR');
    expect(localStorage.getItem('archviewer.locale')).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(messagesFor('pt-BR').open.button).toBe('Abrir projeto');
    expect(messagesFor('en').open.button).toBe('Open project');
  });
});
