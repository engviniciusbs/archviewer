import { DetailPanel } from './components/DetailPanel';
import { EmptyScreen } from './components/EmptyScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { Explorer } from './components/Explorer';
import { GraphErrorBoundary } from './components/GraphErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { GraphCanvas } from './renderer/GraphCanvas';
import { useGraphStore } from './store/graph-store';

function Shell() {
  return (
    <div className="shell">
      <Toolbar />
      <Explorer />
      <main className="shell__graph" aria-label="Grafo de dependências">
        <GraphErrorBoundary>
          <GraphCanvas />
        </GraphErrorBoundary>
      </main>
      <DetailPanel />
      <StatusBar />
    </div>
  );
}

export function App() {
  const phase = useGraphStore((s) => s.phase);
  const error = useGraphStore((s) => s.error);
  switch (phase) {
    case 'empty':
      return <EmptyScreen />;
    case 'error':
      return <ErrorScreen error={error} />;
    case 'ready':
      return <Shell />;
    default:
      return <LoadingScreen />;
  }
}
