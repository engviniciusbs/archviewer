import type { UnresolvedImport } from '@archviewer/core-wasm';
import { REASON } from './format';

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
