import { LOCALES, type LocaleCode } from '../i18n/locales';
import { useLocaleStore, useT } from '../i18n/store';

/** Seletor de idioma; as opções vêm do registro de idiomas, cada uma escrita no próprio idioma. */
export function LanguageSelect({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <select
      className={className ? `language ${className}` : 'language'}
      aria-label={t.language.label}
      value={locale}
      onChange={(e) => setLocale(e.target.value as LocaleCode)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
