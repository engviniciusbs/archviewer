import { dirname, type EdgeRef, type GraphDiff } from '../compare/diff';
import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';

const LIST_LIMIT = 200;

/** Busca o caminho e revela o nó, se ele existe no projeto aberto. */
function useRevealPath() {
  const search = useGraphStore((s) => s.search);
  const reveal = useGraphStore((s) => s.reveal);
  return (path: string) =>
    void search(path).then((hits) => {
      const hit = hits.find((h) => h.path === path);
      if (hit) return reveal(hit);
    });
}

/** Dependências agrupadas por par de pastas: `src → src/lib (3)`. */
function byFolder(edges: EdgeRef[]): string[] {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const key = `${dirname(e.from)} → ${e.external ? e.to : dirname(e.to)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
}

function Section(p: { title: string; items: string[]; go?: (path: string) => void }) {
  const t = useT();
  if (p.items.length === 0) return null;
  const shown = p.items.slice(0, LIST_LIMIT);
  return (
    <>
      <h3 className="detail__heading">
        {p.title}
        <span className="detail__count num">{t.fmt.int(p.items.length)}</span>
      </h3>
      <ul className="compare__list" aria-label={p.title}>
        {shown.map((item) => (
          <li key={item}>
            {p.go ? (
              <button type="button" className="ref" onClick={() => p.go!(item)}>
                <code className="mono">{item}</code>
              </button>
            ) : (
              <code className="mono">{item}</code>
            )}
          </li>
        ))}
        {p.items.length > LIST_LIMIT && <li className="muted">{t.compare.more(p.items.length - LIST_LIMIT)}</li>}
      </ul>
    </>
  );
}

/** Disclosure irmã das outras da barra de status: o que mudou em relação à versão "antes". */
export function ComparePanel(p: { id: string; diff: GraphDiff; onClose: () => void }) {
  const t = useT();
  const go = useRevealPath();
  const d = p.diff;
  const fanIn = d.fanInChanges.map((c) => `${c.path}  ${t.fmt.int(c.before)} → ${t.fmt.int(c.after)}`);
  return (
    <section id={p.id} className="issues cut" aria-label={t.compare.title}>
      <div className="issues__head">
        <h2 className="panel__title">{t.compare.title}</h2>
        <button type="button" className="key key--small" onClick={p.onClose}>
          {t.compare.close}
        </button>
      </div>
      <div className="issues__scroll dead">
        {d.changeCount === 0 && d.fanInChanges.length === 0 && d.newlyUnused.length === 0 ? (
          <p className="muted">{t.compare.none}</p>
        ) : (
          <>
            <Section title={t.compare.filesAdded} items={d.filesAdded} go={go} />
            <Section title={t.compare.filesRemoved} items={d.filesRemoved} />
            <Section title={t.compare.externalsAdded} items={d.externalsAdded} />
            <Section title={t.compare.externalsRemoved} items={d.externalsRemoved} />
            <Section title={t.compare.edgesAdded} items={byFolder(d.edgesAdded)} />
            <Section title={t.compare.edgesRemoved} items={byFolder(d.edgesRemoved)} />
            <Section title={t.compare.cyclesAdded} items={d.cyclesAdded.map((c) => c.join(' ↔ '))} />
            <Section title={t.compare.cyclesResolved} items={d.cyclesResolved.map((c) => c.join(' ↔ '))} />
            <Section title={t.compare.fanIn} items={fanIn} />
            <Section title={t.compare.newlyUnused} items={d.newlyUnused} go={go} />
          </>
        )}
      </div>
    </section>
  );
}
