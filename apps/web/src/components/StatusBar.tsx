import { useId, useState } from 'react';
import type { Summary } from '@archviewer/core-wasm';
import { useGraphStore } from '../store/graph-store';
import { visibleUnresolved } from '../store/selectors';
import { count, seconds } from './format';
import { Icon } from './Icon';
import { IssuesPanel, SkippedPanel } from './IssuesPanel';

type StatusInput = Pick<Summary, 'files' | 'edges' | 'cycles' | 'externals'> & {
  unresolvedShown: number;
  ignored: number;
  elapsedMs: number | null;
};

/** Os itens da barra, na ordem e no formato de que o e2e depende. */
export function statusItems(s: StatusInput): string[] {
  const items = [
    count(s.files, 'arquivo', 'arquivos'),
    count(s.edges, 'aresta', 'arestas'),
    count(s.cycles, 'ciclo', 'ciclos'),
    count(s.externals, 'externo', 'externos'),
    count(s.unresolvedShown, 'não resolvido', 'não resolvidos'),
    count(s.ignored, 'ignorado', 'ignorados'),
  ];
  if (s.elapsedMs !== null) items.push(seconds(s.elapsedMs));
  return items;
}

const UNRESOLVED_INDEX = 4;
const IGNORED_INDEX = 5;

type Disclosure = 'unresolved' | 'ignored';

export function StatusBar() {
  const summary = useGraphStore((s) => s.summary);
  const issues = useGraphStore((s) => s.issues);
  const filters = useGraphStore((s) => s.filters);
  const ingestSkipped = useGraphStore((s) => s.ingestSkipped);
  const elapsedMs = useGraphStore((s) => s.elapsedMs);
  const fallback = useGraphStore((s) => s.fallback);
  const [open, setOpen] = useState<Disclosure | null>(null);
  const unresolvedId = useId();
  const ignoredId = useId();

  if (!summary) return null;
  const unresolved = issues ? visibleUnresolved(issues, filters) : [];
  const items = statusItems({
    ...summary,
    unresolvedShown: issues ? unresolved.length : summary.unresolved,
    ignored: summary.skipped + ingestSkipped.length,
    elapsedMs,
  });
  const warnings = [...new Set([...(issues?.warnings ?? []), ...summary.warnings])];
  const clean = unresolved.length === 0 && warnings.length === 0;
  const skipped = [...(issues?.skipped ?? []), ...ingestSkipped];
  const disclosure: Record<number, { which: Disclosure; id: string }> = {
    [UNRESOLVED_INDEX]: { which: 'unresolved', id: unresolvedId },
    [IGNORED_INDEX]: { which: 'ignored', id: ignoredId },
  };

  return (
    <footer className="statusbar">
      {open === 'unresolved' && (
        <IssuesPanel id={unresolvedId} unresolved={unresolved} onClose={() => setOpen(null)} />
      )}
      {open === 'ignored' && <SkippedPanel id={ignoredId} skipped={skipped} onClose={() => setOpen(null)} />}
      <div className="statusbar__line">
        <div role="status" className={clean ? 'status-line' : 'status-line status-line--warn'}>
          <Icon name={clean ? 'check' : 'warning'} />
          <span className="visually-hidden">{clean ? 'Análise completa' : 'Análise completa, com pendências'}</span>
          <ul className="statusbar__items">
            {items.map((text, i) => (
              <li key={i} className="num">
                {disclosure[i] ? (
                  <button
                    type="button"
                    className="linkish"
                    aria-expanded={open === disclosure[i].which}
                    aria-controls={disclosure[i].id}
                    onClick={() => {
                      const which = disclosure[i]!.which;
                      setOpen((o) => (o === which ? null : which));
                    }}
                  >
                    {text}
                  </button>
                ) : (
                  text
                )}
              </li>
            ))}
          </ul>
        </div>
        {fallback && (
          <p className="statusbar__note">
            <Icon name="info" />
            Seu navegador não tem acesso direto a pastas; usando o seletor de arquivos.
          </p>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="statusbar__warnings" aria-label="Avisos">
          {warnings.map((w) => (
            <li key={w} className="status-line status-line--warn">
              <Icon name="warning" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
