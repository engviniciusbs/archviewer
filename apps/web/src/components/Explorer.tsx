import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SearchHit, VNode } from '@archviewer/core-wasm';
import { useT } from '../i18n/store';
import { useGraphStore, type SearchResults } from '../store/graph-store';
import { metricOf } from '../renderer/heat';
import { explorerRows } from '../store/selectors';
import { Icon, type IconName } from './Icon';
import { Panel } from './Panel';

const kindIcon = (n: VNode): IconName => (n.kind === 'group' ? 'folder' : n.kind === 'external' ? 'package' : 'file');

function Results({ results }: { results: SearchResults }) {
  const t = useT();
  const reveal = useGraphStore((s) => s.reveal);
  const setResults = useGraphStore((s) => s.setSearchResults);
  const pick = (hit: SearchHit) => {
    setResults(null);
    void reveal(hit);
  };
  if (results.hits.length === 0) {
    return (
      <div className="panel__empty">
        <p>{t.explorer.noHits(results.query)}</p>
        <p className="muted">{t.explorer.noHitsHint}</p>
        <button type="button" className="key" onClick={() => setResults(null)}>
          {t.explorer.clear}
        </button>
      </div>
    );
  }
  return (
    <ul className="hits" aria-label={t.explorer.hits(results.query)}>
      {results.hits.map((h) => (
        <li key={h.id}>
          <button type="button" className="row" onClick={() => pick(h)}>
            <Icon name={h.kind === 'group' ? 'folder' : 'file'} className="row__icon" />
            <span className="row__label">{h.label}</span>
            <code className="mono row__path">{h.path}</code>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Tree() {
  const t = useT();
  const graph = useGraphStore((s) => s.graph);
  const hideExternals = useGraphStore((s) => s.filters.hideExternals);
  const selected = useGraphStore((s) => s.selected);
  const colorBy = useGraphStore((s) => s.colorBy);
  const toggle = useGraphStore((s) => s.toggle);
  const select = useGraphStore((s) => s.select);
  const [focusId, setFocusId] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLLIElement>());

  const rows = explorerRows(graph).filter((r) => !(hideExternals && r.node.kind === 'external'));
  if (rows.length === 0) {
    return <p className="panel__empty">{t.explorer.empty}</p>;
  }
  const ids = rows.map((r) => r.node.id);
  const tabId = [focusId, selected].find((id) => id !== null && ids.includes(id)) ?? ids[0];

  const activate = (n: VNode) => {
    if (n.expandable) void toggle(n.id);
    void select(n.id);
  };
  const moveTo = (id: number | undefined) => {
    if (id === undefined) return;
    setFocusId(id);
    refs.current.get(id)?.focus();
  };

  const parentRow = (i: number) => {
    const depth = rows[i]!.depth;
    for (let j = i - 1; j >= 0; j--) if (rows[j]!.depth === depth - 1) return ids[j];
    return undefined;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    const { node, depth } = rows[i]!;
    const isOpen = node.expandable && node.expanded;
    switch (e.key) {
      case 'ArrowDown':
        moveTo(ids[i + 1]);
        break;
      case 'ArrowUp':
        moveTo(ids[i - 1]);
        break;
      case 'Home':
        moveTo(ids[0]);
        break;
      case 'End':
        moveTo(ids[ids.length - 1]);
        break;
      case 'ArrowRight':
        if (node.expandable && !node.expanded) void toggle(node.id);
        else if (isOpen && rows[i + 1]?.depth === depth + 1) moveTo(ids[i + 1]);
        break;
      case 'ArrowLeft':
        if (isOpen) void toggle(node.id);
        else moveTo(parentRow(i));
        break;
      case 'Enter':
      case ' ':
        activate(node);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <ul className="tree" role="tree" aria-label={t.explorer.tree}>
      {rows.map(({ node, depth }, i) => (
        <li
          key={node.id}
          ref={(el) => {
            if (el) refs.current.set(node.id, el);
            else refs.current.delete(node.id);
          }}
          role="treeitem"
          className="row tree__row"
          data-kind={node.kind}
          aria-level={depth + 1}
          aria-expanded={node.expandable ? node.expanded : undefined}
          aria-selected={node.id === selected}
          tabIndex={node.id === tabId ? 0 : -1}
          style={{ '--depth': depth } as CSSProperties}
          onClick={() => {
            setFocusId(node.id);
            activate(node);
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span className="tree__twist" aria-hidden="true">
            {node.expandable && <Icon name="chevron" />}
          </span>
          <Icon name={kindIcon(node)} className="row__icon" />
          <span className="row__label">{node.label}</span>
          {node.kind === 'file' && node.metrics.unused > 0 && (
            <span className="tree__unused">
              <span className="tree__unused-dot" aria-hidden="true" />
              <span className="visually-hidden">{t.explorer.unused}</span>
            </span>
          )}
          {colorBy !== 'none' && colorBy !== 'unused' && colorBy !== 'changes' && metricOf(node, colorBy) !== null && (
            <span className="row__metric num">{t.fmt.int(metricOf(node, colorBy)!)}</span>
          )}
          {node.inCycle && (
            <span className="tree__cycle">
              <Icon name="cycle" />
              <span className="visually-hidden">{t.explorer.inCycle}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Explorer() {
  const t = useT();
  const results = useGraphStore((s) => s.searchResults);
  return (
    <Panel title={results ? t.explorer.searchTitle : t.explorer.title} className="panel--explorer">
      {results ? <Results results={results} /> : <Tree />}
    </Panel>
  );
}
