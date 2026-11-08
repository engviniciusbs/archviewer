import type { GraphData } from '../../types/graph';

interface StatusBarProps {
  graphData: GraphData | null;
  isLoading: boolean;
  error: string | null;
}

export function StatusBar({ graphData, isLoading, error }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        {isLoading && <span className="status-bar__loading">parsing...</span>}
        {error && <span className="status-bar__error">ERR: {error}</span>}
        {graphData && !isLoading && !error && (
          <span className="status-bar__info">
            parsed {graphData.metadata.totalFiles} files · {graphData.metadata.totalEdges} edges · {graphData.metadata.parseTimeMs.toFixed(0)}ms
          </span>
        )}
        {!graphData && !isLoading && !error && <span className="status-bar__muted">ready</span>}
      </div>
      <div className="status-bar__right">
        <span className="status-bar__muted">archviewer v0.1.0</span>
      </div>
    </footer>
  );
}
