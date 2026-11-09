import { useId, useState } from 'react';
import type { Summary, Warning } from '@archviewer/core-wasm';
import type { Messages } from '../i18n/messages/en';
import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';
import { visibleUnresolved } from '../store/selectors';
import { Icon } from './Icon';
import { IssuesPanel, SkippedPanel } from './IssuesPanel';

type StatusInput = Pick<Summary, 'files' | 'edges' | 'cycles' | 'externals'> & {
  unresolvedShown: number;
  ignored: number;
  elapsedMs: number | null;
};

/** Os itens da barra, na ordem e no formato de que o e2e depende. */
export function statusItems(s: StatusInput, t: Messages): string[] {
  const items = [
    t.status.files(s.files),
    t.status.edges(s.edges),
    t.status.cycles(s.cycles),
    t.status.externals(s.externals),
    t.status.unresolved(s.unresolvedShown),
    t.status.ignored(s.ignored),
  ];
  if (s.elapsedMs !== null) items.push(t.fmt.seconds(s.elapsedMs));
  return items;
}

/** Texto de um aviso do núcleo; um código que esta versão da interface não conhece vira `code: subject`. */
export function warningText(t: Messages, w: Warning): string {
  const text = (t.warnings as Partial<Messages['warnings']>)[w.code];
  return text ? text(w.subject) : `${w.code}: ${w.subject}`;
}

const warningKey = (w: Warning) => `${w.code}\u0000${w.subject}`;

const UNRESOLVED_INDEX = 4;
const IGNORED_INDEX = 5;

type Disclosure = 'unresolved' | 'ignored';

export function StatusBar() {
  const t = useT();
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
  const items = statusItems(
    {
      ...summary,
      unresolvedShown: issues ? unresolved.length : summary.unresolved,
      ignored: summary.skipped + ingestSkipped.length,
      elapsedMs,
    },
    t,
  );
  const warnings = [
    ...new Map([...(issues?.warnings ?? []), ...summary.warnings].map((w) => [warningKey(w), w])).values(),
  ];
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
          <span className="visually-hidden">{clean ? t.status.complete : t.status.completeWithIssues}</span>
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
            {t.status.fallback}
          </p>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="statusbar__warnings" aria-label={t.status.warnings}>
          {warnings.map((w) => (
            <li key={warningKey(w)} className="status-line status-line--warn">
              <Icon name="warning" />
              {warningText(t, w)}
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
