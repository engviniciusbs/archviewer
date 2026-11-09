import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, readSavedLocale, saveLocale } from '../../src/i18n/detect';

describe('detectLocale', () => {
  it('prefere a escolha salva', () => {
    expect(detectLocale('pt-BR', ['en-US'])).toBe('pt-BR');
  });
  it('casa o prefixo do idioma do navegador', () => {
    expect(detectLocale(null, ['pt-PT', 'en'])).toBe('pt-BR');
  });
  it('cai em inglês para idiomas sem tradução', () => {
    expect(detectLocale(null, ['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLocale(null, ['fr-FR'])).toBe('en');
  });
  it('cai em inglês sem idiomas do navegador', () => {
    expect(detectLocale(null, [])).toBe('en');
    expect(detectLocale(null, undefined)).toBe('en');
  });
  it('ignora uma escolha salva que não está registrada', () => {
    expect(detectLocale('es', ['pt-BR'])).toBe('pt-BR');
  });
});

describe('persistência', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it('lê e grava em archviewer.locale', () => {
    saveLocale('pt-BR');
    expect(localStorage.getItem('archviewer.locale')).toBe('pt-BR');
    expect(readSavedLocale()).toBe('pt-BR');
  });
  it('não lança quando o localStorage falha', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSavedLocale()).toBeNull();
    expect(() => saveLocale('en')).not.toThrow();
  });
});
