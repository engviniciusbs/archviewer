import { create } from 'zustand';
import { detectLocale, readSavedLocale, saveLocale } from './detect';
import { messagesFor, type LocaleCode } from './locales';
import type { Messages } from './messages/en';

type LocaleState = {
  locale: LocaleCode;
  setLocale(code: LocaleCode): void;
};

const browserLanguages = () => (typeof navigator === 'undefined' ? undefined : navigator.languages);

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectLocale(readSavedLocale(), browserLanguages()),
  setLocale(code) {
    saveLocale(code);
    set({ locale: code });
  },
}));

function applyLang(code: LocaleCode) {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

applyLang(useLocaleStore.getState().locale);
useLocaleStore.subscribe((s) => applyLang(s.locale));

/** Mensagens do idioma ativo; os componentes re-renderizam quando ele muda. */
export const useT = (): Messages => useLocaleStore((s) => messagesFor(s.locale));
