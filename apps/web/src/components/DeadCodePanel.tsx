import type { DeadCode } from '@archviewer/core-wasm';
import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';

const REPORT_URL = 'https://github.com/engviniciusbs/archviewer/issues/new?template=bug_report.yml';

/** Busca o caminho e revela o nó no grafo e no explorador. */
function useRevealPath() {
  const search = useGraphStore((s) => s.search);
  const reveal = useGraphStore((s) => s.reveal);
  return (path: string) =>
    void search(path).then((hits) => {
      const hit = hits.find((h) => h.path === path);
      if (hit) return reveal(hit);
    });
}

function PathTable(p: { label: string; paths: string[]; empty: string; go: (path: string) => void; head: string }) {
  if (p.paths.length === 0) return <p className="muted">{p.empty}</p>;
  return (
    <table className="table" aria-label={p.label}>
      <thead>
        <tr>
          <th scope="col">{p.head}</th>
        </tr>
      </thead>
      <tbody>
        {p.paths.map((path) => (
          <tr key={path}>
            <td>
              <button type="button" className="ref" onClick={() => p.go(path)}>
                <code className="mono">{path}</code>
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Disclosure irmã de "não resolvidos": arquivos e exports que nenhuma entrada usa. */
export function DeadCodePanel(p: { id: string; dead: DeadCode; onClose: () => void }) {
  const t = useT();
  const go = useRevealPath();
  const { dead } = p;
  return (
    <section id={p.id} className="issues cut" aria-label={t.dead.title}>
      <div className="issues__head">
        <h2 className="panel__title">{t.dead.title}</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          {t.dead.close}
        </button>
      </div>
      <div className="issues__scroll dead">
        <h3 className="detail__heading">{t.dead.files}</h3>
        <PathTable label={t.dead.files} head={t.dead.path} paths={dead.unusedFiles} empty={t.dead.none} go={go} />
        <h3 className="detail__heading">{t.dead.testOnly}</h3>
        <PathTable label={t.dead.testOnly} head={t.dead.path} paths={dead.testOnlyFiles} empty={t.dead.none} go={go} />
        <h3 className="detail__heading">{t.dead.exports}</h3>
        {dead.unusedExports.length === 0 ? (
          <p className="muted">{t.dead.none}</p>
        ) : (
          <table className="table" aria-label={t.dead.exports}>
            <thead>
              <tr>
                <th scope="col">{t.dead.path}</th>
                <th scope="col">{t.dead.names}</th>
              </tr>
            </thead>
            <tbody>
              {dead.unusedExports.map((u) => (
                <tr key={u.path}>
                  <td>
                    <button type="button" className="ref" onClick={() => go(u.path)}>
                      <code className="mono">{u.path}</code>
                    </button>
                  </td>
                  <td>
                    <code className="mono">{u.names.join(', ')}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted dead__note">
          {dead.fallback && <strong className="dead__fallback">{t.dead.fallback} </strong>}
          {t.dead.note}{' '}
          <a href={REPORT_URL} target="_blank" rel="noreferrer">
            {t.dead.report}
          </a>
        </p>
      </div>
    </section>
  );
}
