/** Formas de plural: as categorias do CLDR (`one`, `few`…) e formas exatas (`=0`, `=1`), que vencem. */
export type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule | `=${number}`, string>>;

const cache = new Map<string, Intl.NumberFormat | Intl.PluralRules>();

function cached<T extends Intl.NumberFormat | Intl.PluralRules>(key: string, make: () => T): T {
  let v = cache.get(key);
  if (!v) cache.set(key, (v = make()));
  return v as T;
}

const ints = (locale: string) => cached(`int:${locale}`, () => new Intl.NumberFormat(locale));
const tenths = (locale: string) =>
  cached(`1dp:${locale}`, () => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const rules = (locale: string) => cached(`pr:${locale}`, () => new Intl.PluralRules(locale));

export const formatInt = (locale: string, n: number): string => ints(locale).format(n);

/** Milissegundos em segundos com uma casa decimal: `0.4 s`, `0,4 s`. */
export const formatSeconds = (locale: string, ms: number): string => `${tenths(locale).format(ms / 1000)} s`;

/** Escolhe a forma de `n` e troca `#` pelo número formatado. */
export function plural(locale: string, n: number, forms: PluralForms): string {
  const form = forms[`=${n}`] ?? forms[rules(locale).select(n)] ?? forms.other;
  return form.replace('#', formatInt(locale, n));
}
