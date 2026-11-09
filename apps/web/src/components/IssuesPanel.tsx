import type { SkippedFile, UnresolvedImport } from '@archviewer/core-wasm';
import type { IngestSkip } from '../ingest/read';
import { useT } from '../i18n/store';

/** Disclosure inline (não modal) com os imports sem destino e o motivo de cada um. */
export function IssuesPanel(p: { id: string; unresolved: UnresolvedImport[]; onClose: () => void }) {
  const t = useT();
  return (
    <section id={p.id} className="issues cut" aria-label={t.issues.title}>
      <div className="issues__head">
        <h2 className="panel__title">{t.issues.title}</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          {t.issues.close}
        </button>
      </div>
      {p.unresolved.length === 0 ? (
        <p className="muted">{t.issues.allResolved}</p>
      ) : (
        <div className="issues__scroll">
          <table className="table" aria-label={t.issues.table}>
            <thead>
              <tr>
                <th scope="col">{t.issues.file}</th>
                <th scope="col">{t.issues.import}</th>
                <th scope="col">{t.issues.reason}</th>
              </tr>
            </thead>
            <tbody>
              {p.unresolved.map((u, i) => (
                <tr key={i}>
                  <td>
                    <code className="mono">{u.from}</code>
                  </td>
                  <td>
                    <code className="mono">{u.specifier}</code>
                  </td>
                  <td>{t.reasons[u.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Disclosure irmã: arquivos e pastas que ficaram de fora, com o motivo de cada um. */
export function SkippedPanel(p: { id: string; skipped: (SkippedFile | IngestSkip)[]; onClose: () => void }) {
  const t = useT();
  return (
    <section id={p.id} className="issues cut" aria-label={t.skipped.title}>
      <div className="issues__head">
        <h2 className="panel__title">{t.skipped.title}</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          {t.skipped.close}
        </button>
      </div>
      {p.skipped.length === 0 ? (
        <p className="muted">{t.skipped.none}</p>
      ) : (
        <div className="issues__scroll">
          <table className="table" aria-label={t.skipped.table}>
            <thead>
              <tr>
                <th scope="col">{t.skipped.path}</th>
                <th scope="col">{t.skipped.reason}</th>
              </tr>
            </thead>
            <tbody>
              {p.skipped.map((s, i) => (
                <tr key={i}>
                  <td>
                    <code className="mono">{s.path}</code>
                  </td>
                  <td>{t.skipReasons[s.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
