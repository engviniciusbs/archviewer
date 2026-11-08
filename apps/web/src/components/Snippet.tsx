import { useEffect, useState } from 'react';
import type { DepRef } from '@archviewer/core-wasm';
import type { DirSource } from '../ingest/source';

const MAX_LINES = 40;

/** Fonte de módulo citada numa linha: `from '…'`, `import '…'`, `import('…')`, `require('…')`. */
const MODULE_SOURCE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

/** Caminho sem extensão JS/TS e sem `/index` final. */
const bare = (p: string) => p.replace(/(?:\.d\.ts|\.[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');

function resolveRelative(from: string, spec: string): string {
  const out = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function sourceMatches(spec: string, from: string, ref: DepRef): boolean {
  const target = bare(ref.path);
  if (spec.startsWith('.')) return bare(resolveRelative(from, spec)) === target;
  if (/^[@~#]\//.test(spec)) {
    const rest = bare(spec.slice(2));
    return target === rest || target.endsWith(`/${rest}`);
  }
  return spec === ref.path || spec.startsWith(`${ref.path}/`);
}

/**
 * Uma linha é destacada quando cita, como fonte de módulo, um dos imports resolvidos do arquivo.
 * Regra: o texto entre aspas depois de `from`, `import`, `import(` ou `require(` é comparado com
 * `imports[].path`. Relativos (`./`, `../`) são resolvidos a partir de `from` e comparados sem
 * extensão nem `/index`; aliases `@/`, `~/` e `#/` casam pelo sufixo do caminho; specifiers puros
 * (`react`, `react/jsx-runtime`) casam com o nome do pacote externo. `DepRef.specifiers` são os
 * nomes importados (`useState`, `default`), não a fonte, por isso não entram na regra.
 */
export function importLineMatches(line: string, from: string, imports: DepRef[]): boolean {
  for (const m of line.matchAll(MODULE_SOURCE)) {
    const spec = m[2]!;
    if (imports.some((ref) => sourceMatches(spec, from, ref))) return true;
  }
  return false;
}

type Loaded = { path: string; lines: string[] } | { path: string; failed: true };

export function Snippet(p: { source: DirSource; path: string; imports: DepRef[] }) {
  const { source, path } = p;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    source.read(path).then(
      (text) => {
        if (!live) return;
        const lines = text.split(/\r?\n/);
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        setLoaded({ path, lines: lines.slice(0, MAX_LINES) });
      },
      () => {
        if (live) setLoaded({ path, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [source, path]);

  if (!loaded || loaded.path !== path) {
    return <div className="snippet snippet--loading graphite" aria-busy="true" aria-label="Carregando trecho" />;
  }
  if ('failed' in loaded) {
    return <p className="snippet__error muted">Não foi possível ler o arquivo</p>;
  }
  return (
    <pre className="snippet graphite" aria-label={`Primeiras ${loaded.lines.length} linhas de ${path}`}>
      <code>
        {loaded.lines.map((line, i) => (
          <span
            key={i}
            data-testid="snippet-line"
            className={importLineMatches(line, path, p.imports) ? 'snippet__line snippet__line--import' : 'snippet__line'}
          >
            <span className="snippet__no" aria-hidden="true">
              {i + 1}
            </span>
            {line}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}
