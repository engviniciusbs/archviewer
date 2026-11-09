import { DEFAULT_LOCALE, LOCALES, type LocaleCode } from './locales';

const KEY = 'archviewer.locale';

const lower = (s: string) => s.toLowerCase();
const prefix = (s: string) => lower(s).split('-')[0];

function exact(tag: string): LocaleCode | undefined {
  return LOCALES.find((l) => lower(l.code) === lower(tag))?.code;
}

function byPrefix(tag: string): LocaleCode | undefined {
  return LOCALES.find((l) => prefix(l.code) === prefix(tag))?.code;
}

/** Escolha salva, depois cada idioma do navegador em ordem (código exato, depois prefixo), depois inglês. */
export function detectLocale(saved: string | null, languages: readonly string[] | undefined): LocaleCode {
  const fromSaved = saved ? exact(saved) : undefined;
  if (fromSaved) return fromSaved;
  for (const tag of languages ?? []) {
    const hit = exact(tag) ?? byPrefix(tag);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

/** O armazenamento pode estar bloqueado (janela privada, dados do site desligados): nunca lança. */
export function readSavedLocale(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveLocale(code: LocaleCode): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Sem armazenamento, a escolha vale só para esta visita.
  }
}
