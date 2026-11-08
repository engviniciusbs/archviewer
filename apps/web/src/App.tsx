import { DetailPanel } from './components/DetailPanel';
import { EmptyScreen } from './components/EmptyScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { Explorer } from './components/Explorer';
import { formatInt } from './components/format';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { GraphCanvas } from './renderer/GraphCanvas';
import { useGraphStore } from './store/graph-store';

/** Placeholder das fases de leitura; a Task 7 troca por LoadingScreen. */
function LoadingPlaceholder() {
  const phase = useGraphStore((s) => s.phase);
  const progress = useGraphStore((s) => s.progress);
  const pendingCount = useGraphStore((s) => s.pendingCount);
  const confirmLarge = useGraphStore((s) => s.confirmLarge);
  const cancel = useGraphStore((s) => s.cancel);
  return (
    <main className="screen">
      <div className="screen__panel cut">
        <div role="status">
          <p>Lendo projeto…</p>
          {progress && (
            <p className="num muted">
              {formatInt(progress.read)} de {formatInt(progress.total)} arquivos
            </p>
          )}
          {phase === 'confirm' && <p className="num">{formatInt(pendingCount)} arquivos de código. Ler mesmo assim?</p>}
        </div>
        <div className="screen__actions">
          {phase === 'confirm' && (
            <button type="button" className="key key--primary" onClick={() => confirmLarge(true)}>
              Ler projeto
            </button>
          )}
          <button type="button" className="key" onClick={cancel}>
            Cancelar
          </button>
        </div>
      </div>
    </main>
  );
}

function Shell() {
  return (
    <div className="shell">
      <Toolbar />
      <Explorer />
      <main className="shell__graph" aria-label="Grafo de dependências">
        <GraphCanvas />
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
      return <LoadingPlaceholder />;
  }
}
