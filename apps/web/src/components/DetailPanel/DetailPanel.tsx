import type { GraphData, GraphNode } from '../../types/graph';

interface DetailPanelProps {
  node: GraphNode | null;
  graphData: GraphData | null;
}

export function DetailPanel({ node, graphData }: DetailPanelProps) {
  if (!node) {
    return (
      <div className="detail-panel detail-panel--empty">
        <p className="detail-panel__hint"><span className="toolbar__muted">#</span> select a node</p>
      </div>
    );
  }

  const imports = graphData?.edges.filter(e => {
    const sourceId = typeof e.source === 'string' ? e.source : e.source.id;
    return sourceId === node.id;
  }) ?? [];

  const importedBy = graphData?.edges.filter(e => {
    const targetId = typeof e.target === 'string' ? e.target : e.target.id;
    return targetId === node.id;
  }) ?? [];

  return (
    <div className="detail-panel">
      <div className="detail-panel__section">
        <h3 className="detail-panel__title"># {node.id.split('/').pop()}</h3>
        <div className="detail-panel__meta">
          <div><span className="toolbar__muted">path:</span> {node.path}</div>
          <div><span className="toolbar__muted">type:</span> {node.type}</div>
          <div><span className="toolbar__muted">lang:</span> {node.language}</div>
          <div><span className="toolbar__muted">loc:</span> {node.loc}</div>
        </div>
      </div>

      {node.exports.length > 0 && (
        <div className="detail-panel__section">
          <h4 className="detail-panel__subtitle"># exports</h4>
          <ul className="detail-panel__list">
            {node.exports.map(exp => <li key={exp} className="detail-panel__export">{exp}</li>)}
          </ul>
        </div>
      )}

      {imports.length > 0 && (
        <div className="detail-panel__section">
          <h4 className="detail-panel__subtitle"># imports ({imports.length})</h4>
          <ul className="detail-panel__list">
            {imports.map((edge, i) => {
              const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
              return (
                <li key={i} className={`detail-panel__import ${edge.circular ? 'detail-panel__import--circular' : ''}`}>
                  {edge.circular && <span className="detail-panel__circular">⟳</span>}{target}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {importedBy.length > 0 && (
        <div className="detail-panel__section">
          <h4 className="detail-panel__subtitle"># imported by ({importedBy.length})</h4>
          <ul className="detail-panel__list">
            {importedBy.map((edge, i) => {
              const source = typeof edge.source === 'string' ? edge.source : edge.source.id;
              return <li key={i} className="detail-panel__import">{source}</li>;
            })}
          </ul>
        </div>
      )}

      {node.parseError && (
        <div className="detail-panel__section detail-panel__section--error">
          <h4 className="detail-panel__subtitle"># parse error</h4>
          <pre className="detail-panel__error">{node.parseError}</pre>
        </div>
      )}
    </div>
  );
}
