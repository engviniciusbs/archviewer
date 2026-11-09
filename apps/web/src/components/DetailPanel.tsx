import type { ReactNode } from 'react';
import type { DepRef, Detail, WeightedRef } from '@archviewer/core-wasm';
import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';
import { basename } from './format';
import { Icon } from './Icon';
import { Panel } from './Panel';
import { Snippet } from './Snippet';

type FileD = Extract<Detail, { kind: 'file' }>;
type GroupD = Extract<Detail, { kind: 'group' }>;
type ExternalD = Extract<Detail, { kind: 'external' }>;
type Go = (ref: { id: number; path: string }) => void;

/** Navega até um nó: seleciona se já está desenhado; senão busca o caminho e revela. */
function useGo(): Go {
  const graph = useGraphStore((s) => s.graph);
  const select = useGraphStore((s) => s.select);
  const reveal = useGraphStore((s) => s.reveal);
  const search = useGraphStore((s) => s.search);
  return (ref) => {
    const shown = graph.nodes.find((n) => n.id === ref.id);
    if (shown && !shown.expanded) {
      void select(ref.id);
      return;
    }
    void search(ref.path).then((hits) => {
      const hit = hits.find((h) => h.id === ref.id);
      if (hit) return reveal(hit);
    });
  };
}

function Figure(p: { label: string; value: number; testId: string }) {
  const t = useT();
  return (
    <div className="figures__item">
      <dt className="label">{p.label}</dt>
      <dd className="figure" data-testid={p.testId}>
        {t.fmt.int(p.value)}
      </dd>
    </div>
  );
}

function Section(p: { title: string; n?: number; children: ReactNode }) {
  const t = useT();
  return (
    <section className="detail__section">
      <h4 className="detail__heading">
        {p.title}
        {p.n !== undefined && <span className="detail__count num">{t.fmt.int(p.n)}</span>}
      </h4>
      {p.children}
    </section>
  );
}

function RefList(p: { label: string; refs: DepRef[]; go: Go; empty: string }) {
  const t = useT();
  if (p.refs.length === 0) return <p className="muted">{p.empty}</p>;
  return (
    <ul className="refs" aria-label={p.label}>
      {p.refs.map((r) => (
        <li key={`${r.id}-${r.kind}`} className="refs__item">
          <button type="button" className="ref" onClick={() => p.go(r)}>
            <code className="mono">{r.path}</code>
          </button>
          {r.kind !== 'static' && <span className="refs__note">{t.importKind[r.kind]}</span>}
        </li>
      ))}
    </ul>
  );
}

function WeightedList(p: { label: string; refs: WeightedRef[]; go: Go }) {
  const t = useT();
  if (p.refs.length === 0) return <p className="muted">{t.detail.none}</p>;
  return (
    <ul className="refs" aria-label={p.label}>
      {p.refs.map((r) => (
        <li key={r.id} className="refs__item">
          <button type="button" className="ref" onClick={() => p.go(r)}>
            <code className="mono">{r.path || t.detail.root}</code>
          </button>
          <span className="refs__weight num">{t.fmt.int(r.weight)}</span>
        </li>
      ))}
    </ul>
  );
}

function Head(p: { title: string; path?: string; children?: ReactNode }) {
  return (
    <div className="detail__head">
      <h3 className="detail__title">{p.title}</h3>
      {p.path !== undefined && <code className="mono detail__path">{p.path}</code>}
      {p.children}
    </div>
  );
}

function CycleNote({ cycle }: { cycle?: string[] }) {
  const t = useT();
  return (
    <div className="detail__warn">
      <p className="status-line status-line--error">
        <Icon name="cycle" />
        {t.detail.inCycle}
      </p>
      {cycle && cycle.length > 0 && (
        <ol className="cycle" aria-label={t.detail.cycle}>
          {cycle.map((p, i) => (
            <li key={i}>
              <code className="mono">{p}</code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FileView({ d, go }: { d: FileD; go: Go }) {
  const t = useT();
  const source = useGraphStore((s) => s.source);
  return (
    <>
      <Head title={basename(d.path)} path={d.path} />
      <dl className="figures">
        <Figure label={t.detail.fanIn} value={d.fanIn} testId="fan-in" />
        <Figure label={t.detail.fanOut} value={d.fanOut} testId="fan-out" />
      </dl>
      <p className="muted detail__meta">
        {t.detail.lines(d.loc)}, {d.language.toUpperCase()}
      </p>
      {d.cycle.length > 0 && <CycleNote cycle={d.cycle} />}
      {d.parseErrors.length > 0 && (
        <Section title={t.detail.parseErrors} n={d.parseErrors.length}>
          <ul className="errors" aria-label={t.detail.parseErrors}>
            {d.parseErrors.map((e, i) => (
              <li key={i}>
                <code className="mono">{`${e.line}:${e.column}`}</code> <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t.detail.imports} n={d.imports.length}>
        <RefList label={t.detail.imports} refs={d.imports} go={go} empty={t.detail.noImports} />
      </Section>
      <Section title={t.detail.dependents} n={d.importedBy.length}>
        <RefList label={t.detail.dependents} refs={d.importedBy} go={go} empty={t.detail.noDependents} />
      </Section>
      {d.unresolved.length > 0 && (
        <Section title={t.detail.unresolved} n={d.unresolved.length}>
          <ul className="errors" aria-label={t.detail.unresolved}>
            {d.unresolved.map((u, i) => (
              <li key={i}>
                <code className="mono">{u.specifier}</code> <span className="muted">{t.reasons[u.reason]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.exports.length > 0 && (
        <Section title={t.detail.exports} n={d.exports.length}>
          <ul className="exports" aria-label={t.detail.exports}>
            {d.exports.map((e) => (
              <li key={e}>
                <code className="mono">{e}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {source && (
        <Section title={t.detail.snippet}>
          <Snippet source={source} path={d.path} imports={d.imports} />
        </Section>
      )}
    </>
  );
}

function GroupView({ d, go }: { d: GroupD; go: Go }) {
  const t = useT();
  return (
    <>
      <Head title={d.label} path={d.path}>
        <p className="muted">{d.groupKind === 'package' ? t.detail.package : t.detail.folder}</p>
      </Head>
      <dl className="figures">
        <Figure label={t.detail.files} value={d.fileCount} testId="file-count" />
        <Figure label={t.detail.loc} value={d.loc} testId="loc" />
      </dl>
      {d.inCycle && <CycleNote />}
      <Section title={t.detail.outgoing}>
        <WeightedList label={t.detail.topOutgoing} refs={d.topOutgoing} go={go} />
      </Section>
      <Section title={t.detail.incoming}>
        <WeightedList label={t.detail.topIncoming} refs={d.topIncoming} go={go} />
      </Section>
    </>
  );
}

function ExternalView({ d, go }: { d: ExternalD; go: Go }) {
  const t = useT();
  return (
    <>
      <Head title={d.name}>
        <p className="muted">{t.detail.external}</p>
      </Head>
      <dl className="figures">
        <Figure label={t.detail.fanIn} value={d.importedBy.length} testId="fan-in" />
      </dl>
      <Section title={t.detail.importedBy} n={d.importedBy.length}>
        <RefList label={t.detail.importedBy} refs={d.importedBy} go={go} empty={t.detail.noFiles} />
      </Section>
    </>
  );
}

export function DetailPanel() {
  const t = useT();
  const selected = useGraphStore((s) => s.selected);
  const detail = useGraphStore((s) => s.detail);
  const detailError = useGraphStore((s) => s.detailError);
  const graph = useGraphStore((s) => s.graph);
  const expanded = useGraphStore((s) => s.expanded);
  const toggle = useGraphStore((s) => s.toggle);
  const go = useGo();

  const parentId = graph.nodes.find((n) => n.id === selected)?.parentId;
  const canCollapse = parentId !== undefined && parentId !== 0 && expanded.includes(parentId);
  const collapse = canCollapse ? (
    <button type="button" className="key key--small" onClick={() => void toggle(parentId)}>
      {t.detail.collapseFolder}
    </button>
  ) : undefined;

  let body: ReactNode;
  if (selected === null) {
    body = (
      <div className="panel__empty">
        <p>{t.detail.emptyTitle}</p>
        <p className="muted">{t.detail.emptyHint}</p>
      </div>
    );
  } else if (detailError === selected) {
    body = (
      <div className="panel__empty">
        <p className="status-line status-line--error">
          <Icon name="warning" />
          {t.detail.errorTitle}
        </p>
        <p className="muted">{t.detail.errorHint}</p>
      </div>
    );
  } else if (!detail || detail.id !== selected) {
    body = (
      <div className="skeleton" aria-busy="true" aria-label={t.detail.loading}>
        <span className="skeleton__bar" />
        <span className="skeleton__bar skeleton__bar--short" />
        <span className="skeleton__block" />
      </div>
    );
  } else if (detail.kind === 'file') {
    body = <FileView d={detail} go={go} />;
  } else if (detail.kind === 'group') {
    body = <GroupView d={detail} go={go} />;
  } else {
    body = <ExternalView d={detail} go={go} />;
  }

  return (
    <Panel title={t.detail.title} className="panel--detail" actions={collapse}>
      <div className="detail">{body}</div>
    </Panel>
  );
}
