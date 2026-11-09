import { en, type Messages } from './messages/en';
import { ptBR } from './messages/pt-BR';

/** Idiomas registrados. `name` vem escrito no próprio idioma, como o seletor mostra. */
export const LOCALES = [
  { code: 'en', name: 'English', messages: en },
  { code: 'pt-BR', name: 'Português', messages: ptBR },
] as const satisfies readonly { code: string; name: string; messages: Messages }[];

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: LocaleCode = 'en';

export function messagesFor(code: LocaleCode): Messages {
  return LOCALES.find((l) => l.code === code)!.messages;
}
