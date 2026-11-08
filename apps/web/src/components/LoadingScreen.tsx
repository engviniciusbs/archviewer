import { useGraphStore } from '../store/graph-store';
import { AsciiField } from './AsciiField';
import { formatInt } from './format';

export function LoadingScreen() {
  const phase = useGraphStore((s) => s.phase);
  const progress = useGraphStore((s) => s.progress);
  const pendingCount = useGraphStore((s) => s.pendingCount);
  const confirmLarge = useGraphStore((s) => s.confirmLarge);
  const cancel = useGraphStore((s) => s.cancel);

  let ratio = 0;
  if (phase === 'reading' && progress && progress.total > 0) ratio = Math.min(1, progress.read / progress.total);
  else if (phase === 'analyzing') ratio = 1;

  const confirming = phase === 'confirm';
  let message = 'Procurando arquivos…';
  if (phase === 'reading') {
    message = progress ? `Lendo ${formatInt(progress.read)} de ${formatInt(progress.total)} arquivos` : 'Lendo arquivos…';
  } else if (phase === 'analyzing') message = 'Analisando imports…';

  return (
    <main className="loading">
      <div className="loading__field">
        <AsciiField ratio={ratio} />
      </div>
      <div className="loading__panel cut">
        {confirming ? (
          <p className="loading__message">
            Este projeto tem {formatInt(pendingCount)} arquivos de código. Ler mesmo assim?
          </p>
        ) : (
          <div role="status" className="loading__message">
            <p>{message}</p>
            {phase === 'reading' && progress && (
              <div
                className="loading__bar"
                role="progressbar"
                aria-label="Progresso da leitura"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.read}
              >
                <div className="loading__bar-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
            )}
          </div>
        )}
        <div className="screen__actions">
          {confirming && (
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
