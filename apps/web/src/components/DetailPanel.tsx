import type { ReactNode } from 'react';
import type { DepRef, Detail, ImportKind, WeightedRef } from '@archviewer/core-wasm';
import { useGraphStore } from '../store/graph-store';
import { basename, count, formatInt, REASON } from './format';
import { Icon } from './Icon';
import { Panel } from './Panel';
import { Snippet } from './Snippet';

type FileD = Extract<Detail, { kind: 'file' }>;
type GroupD = Extract<Detail, { kind: 'group' }>;
type ExternalD = Extract<Detail, { kind: 'external' }>;
type Go = (ref: { id: number; path: string }) => void;

const KIND_NOTE: Partial<Record<ImportKind, string>> = {
  dynamic: 'dinâmico',
  reexport: 'reexport',
  require: 'require',
  typeOnly: 'só tipos',
};

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
  return (
    <div className="figures__item">
      <dt className="label">{p.label}</dt>
      <dd className="figure" data-testid={p.testId}>
        {formatInt(p.value)}
      </dd>
    </div>
  );
}

function Section(p: { title: string; n?: number; children: ReactNode }) {
  return (
    <section className="detail__section">
      <h4 className="detail__heading">
        {p.title}
        {p.n !== undefined && <span className="detail__count num">{formatInt(p.n)}</span>}
      </h4>
      {p.children}
    </section>
  );
}

function RefList(p: { label: string; refs: DepRef[]; go: Go; empty: string }) {
  if (p.refs.length === 0) return <p className="muted">{p.empty}</p>;
  return (
    <ul className="refs" aria-label={p.label}>
      {p.refs.map((r) => (
        <li key={`${r.id}-${r.kind}`} className="refs__item">
          <button type="button" className="ref" onClick={() => p.go(r)}>
            <code className="mono">{r.path}</code>
          </button>
          {KIND_NOTE[r.kind] && <span className="refs__note">{KIND_NOTE[r.kind]}</span>}
        </li>
      ))}
    </ul>
  );
}

function WeightedList(p: { label: string; refs: WeightedRef[]; go: Go }) {
  if (p.refs.length === 0) return <p className="muted">Nenhuma.</p>;
  return (
    <ul className="refs" aria-label={p.label}>
      {p.refs.map((r) => (
        <li key={r.id} className="refs__item">
          <button type="button" className="ref" onClick={() => p.go(r)}>
            <code className="mono">{r.path || '(raiz)'}</code>
          </button>
          <span className="refs__weight num">{formatInt(r.weight)}</span>
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
  return (
    <div className="detail__warn">
      <p className="status-line status-line--error">
        <Icon name="cycle" />
        Faz parte de um ciclo
      </p>
      {cycle && cycle.length > 0 && (
        <ol className="cycle" aria-label="Ciclo">
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
  const source = useGraphStore((s) => s.source);
  return (
    <>
      <Head title={basename(d.path)} path={d.path} />
      <dl className="figures">
        <Figure label="Fan-in" value={d.fanIn} testId="fan-in" />
        <Figure label="Fan-out" value={d.fanOut} testId="fan-out" />
      </dl>
      <p className="muted detail__meta">
        {count(d.loc, 'linha', 'linhas')}, {d.language.toUpperCase()}
      </p>
      {d.cycle.length > 0 && <CycleNote cycle={d.cycle} />}
      {d.parseErrors.length > 0 && (
        <Section title="Erros de parse" n={d.parseErrors.length}>
          <ul className="errors" aria-label="Erros de parse">
            {d.parseErrors.map((e, i) => (
              <li key={i}>
                <code className="mono">{`${e.line}:${e.column}`}</code> <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Imports" n={d.imports.length}>
        <RefList label="Imports" refs={d.imports} go={go} empty="Não importa nenhum arquivo." />
      </Section>
      <Section title="Dependentes" n={d.importedBy.length}>
        <RefList label="Dependentes" refs={d.importedBy} go={go} empty="Nenhum arquivo importa este." />
      </Section>
      {d.unresolved.length > 0 && (
        <Section title="Não resolvidos" n={d.unresolved.length}>
          <ul className="errors" aria-label="Não resolvidos">
            {d.unresolved.map((u, i) => (
              <li key={i}>
                <code className="mono">{u.specifier}</code> <span className="muted">{REASON[u.reason]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.exports.length > 0 && (
        <Section title="Exports" n={d.exports.length}>
          <ul className="exports" aria-label="Exports">
            {d.exports.map((e) => (
              <li key={e}>
                <code className="mono">{e}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {source && (
        <Section title="Trecho">
          <Snippet source={source} path={d.path} imports={d.imports} />
        </Section>
      )}
    </>
  );
}

function GroupView({ d, go }: { d: GroupD; go: Go }) {
  return (
    <>
      <Head title={d.label} path={d.path}>
        <p className="muted">{d.groupKind === 'package' ? 'Pacote do workspace' : 'Pasta'}</p>
      </Head>
      <dl className="figures">
        <Figure label="Arquivos" value={d.fileCount} testId="file-count" />
        <Figure label="Linhas" value={d.loc} testId="loc" />
      </dl>
      {d.inCycle && <CycleNote />}
      <Section title="Saída">
        <WeightedList label="Maiores dependências de saída" refs={d.topOutgoing} go={go} />
      </Section>
      <Section title="Entrada">
        <WeightedList label="Maiores dependências de entrada" refs={d.topIncoming} go={go} />
      </Section>
    </>
  );
}

function ExternalView({ d, go }: { d: ExternalD; go: Go }) {
  return (
    <>
      <Head title={d.name}>
        <p className="muted">Pacote externo</p>
      </Head>
      <dl className="figures">
        <Figure label="Fan-in" value={d.importedBy.length} testId="fan-in" />
      </dl>
      <Section title="Importado por" n={d.importedBy.length}>
        <RefList label="Importado por" refs={d.importedBy} go={go} empty="Nenhum arquivo." />
      </Section>
    </>
  );
}

export function DetailPanel() {
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
      Recolher pasta
    </button>
  ) : undefined;

  let body: ReactNode;
  if (selected === null) {
    body = (
      <div className="panel__empty">
        <p>Selecione um nó no grafo ou no explorador</p>
        <p className="muted">Aqui aparecem imports, dependentes, ciclos e o trecho do arquivo.</p>
      </div>
    );
  } else if (detailError === selected) {
    body = (
      <div className="panel__empty">
        <p className="status-line status-line--error">
          <Icon name="warning" />
          Não foi possível carregar os detalhes
        </p>
        <p className="muted">Selecione o nó de novo ou escolha outro no grafo ou no explorador.</p>
      </div>
    );
  } else if (!detail || detail.id !== selected) {
    body = (
      <div className="skeleton" aria-busy="true" aria-label="Carregando detalhes">
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
    <Panel title="Detalhes" className="panel--detail" actions={collapse}>
      <div className="detail">{body}</div>
    </Panel>
  );
}
