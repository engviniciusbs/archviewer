import { useId, useState } from 'react';
import type { Summary, Warning } from '@archviewer/core-wasm';
import type { Messages } from '../i18n/messages/en';
import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';
import { visibleUnresolved } from '../store/selectors';
import { Icon } from './Icon';
import { ComparePanel } from './ComparePanel';
import { DeadCodePanel } from './DeadCodePanel';
import { IssuesPanel, SkippedPanel } from './IssuesPanel';

type StatusInput = Pick<Summary, 'files' | 'edges' | 'cycles' | 'externals'> & {
  unresolvedShown: number;
  ignored: number;
  unused: number;
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
    t.status.unused(s.unused),
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
const UNUSED_INDEX = 6;

type Disclosure = 'unresolved' | 'ignored' | 'unused' | 'changes';

export function StatusBar() {
  const t = useT();
  const summary = useGraphStore((s) => s.summary);
  const issues = useGraphStore((s) => s.issues);
  const filters = useGraphStore((s) => s.filters);
  const ingestSkipped = useGraphStore((s) => s.ingestSkipped);
  const elapsedMs = useGraphStore((s) => s.elapsedMs);
  const deadCode = useGraphStore((s) => s.deadCode);
  const comparison = useGraphStore((s) => s.comparison);
  const clearComparison = useGraphStore((s) => s.clearComparison);
  const fallback = useGraphStore((s) => s.fallback);
  const [open, setOpen] = useState<Disclosure | null>(null);
  const unresolvedId = useId();
  const ignoredId = useId();
  const unusedId = useId();
  const changesId = useId();

  if (!summary) return null;
  const unresolved = issues ? visibleUnresolved(issues, filters) : [];
  const items = statusItems(
    {
      ...summary,
      unresolvedShown: issues ? unresolved.length : summary.unresolved,
      ignored: summary.skipped + ingestSkipped.length,
      unused: deadCode?.unusedFiles.length ?? 0,
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
    [UNUSED_INDEX]: { which: 'unused', id: unusedId },
  };

  return (
    <footer className="statusbar">
      {open === 'unresolved' && (
        <IssuesPanel id={unresolvedId} unresolved={unresolved} onClose={() => setOpen(null)} />
      )}
      {open === 'ignored' && <SkippedPanel id={ignoredId} skipped={skipped} onClose={() => setOpen(null)} />}
      {open === 'changes' && comparison && (
        <ComparePanel id={changesId} diff={comparison.diff} onClose={() => setOpen(null)} />
      )}
      {open === 'unused' && deadCode && (
        <DeadCodePanel id={unusedId} dead={deadCode} onClose={() => setOpen(null)} />
      )}
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
            {comparison && (
              <li className="num statusbar__compare">
                <span className="compare__pill">
                  {t.compare.pill(comparison.label)}
                  <button type="button" className="compare__x" aria-label={t.compare.stop} onClick={clearComparison}>
                    ×
                  </button>
                </span>
                <button
                  type="button"
                  className="linkish statusbar__changes"
                  aria-expanded={open === 'changes'}
                  aria-controls={changesId}
                  onClick={() => setOpen((o) => (o === 'changes' ? null : 'changes'))}
                >
                  {t.compare.changes(comparison.diff.changeCount)}
                </button>
              </li>
            )}
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
