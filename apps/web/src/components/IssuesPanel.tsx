import type { SkippedFile, UnresolvedImport } from '@archviewer/core-wasm';
import type { IngestSkip } from '../ingest/read';
import { REASON, SKIP_REASON } from './format';

/** Disclosure inline (não modal) com os imports sem destino e o motivo de cada um. */
export function IssuesPanel(p: { id: string; unresolved: UnresolvedImport[]; onClose: () => void }) {
  return (
    <section id={p.id} className="issues cut" aria-label="Não resolvidos">
      <div className="issues__head">
        <h2 className="panel__title">Não resolvidos</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          Fechar
        </button>
      </div>
      {p.unresolved.length === 0 ? (
        <p className="muted">Todos os imports apontam para um arquivo ou pacote.</p>
      ) : (
        <div className="issues__scroll">
          <table className="table" aria-label="Imports não resolvidos">
            <thead>
              <tr>
                <th scope="col">Arquivo</th>
                <th scope="col">Import</th>
                <th scope="col">Motivo</th>
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
                  <td>{REASON[u.reason]}</td>
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
  return (
    <section id={p.id} className="issues cut" aria-label="Ignorados">
      <div className="issues__head">
        <h2 className="panel__title">Ignorados</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          Fechar
        </button>
      </div>
      {p.skipped.length === 0 ? (
        <p className="muted">Nenhum arquivo ficou de fora da análise.</p>
      ) : (
        <div className="issues__scroll">
          <table className="table" aria-label="Arquivos ignorados">
            <thead>
              <tr>
                <th scope="col">Caminho</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {p.skipped.map((s, i) => (
                <tr key={i}>
                  <td>
                    <code className="mono">{s.path}</code>
                  </td>
                  <td>{SKIP_REASON[s.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
