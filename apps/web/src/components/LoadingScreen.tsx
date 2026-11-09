import { useT } from '../i18n/store';
import { useGraphStore } from '../store/graph-store';
import { AsciiField } from './AsciiField';

export function LoadingScreen() {
  const t = useT();
  const phase = useGraphStore((s) => s.phase);
  const progress = useGraphStore((s) => s.progress);
  const pendingCount = useGraphStore((s) => s.pendingCount);
  const confirmLarge = useGraphStore((s) => s.confirmLarge);
  const cancel = useGraphStore((s) => s.cancel);

  let ratio = 0;
  if (phase === 'reading' && progress && progress.total > 0) ratio = Math.min(1, progress.read / progress.total);
  else if (phase === 'analyzing') ratio = 1;

  const confirming = phase === 'confirm';
  let message = t.loading.scanning;
  if (phase === 'reading') {
    message = progress ? t.loading.readingProgress(progress.read, progress.total) : t.loading.reading;
  } else if (phase === 'analyzing') message = t.loading.analyzing;

  return (
    <main className="loading">
      <div className="loading__field">
        <AsciiField ratio={ratio} />
      </div>
      <div className="loading__panel cut">
        {confirming ? (
          <p className="loading__message">{t.loading.confirm(pendingCount)}</p>
        ) : (
          <div role="status" className="loading__message">
            <p>{message}</p>
            {phase === 'reading' && progress && (
              <div
                className="loading__bar"
                role="progressbar"
                aria-label={t.loading.progress}
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
              {t.loading.readProject}
            </button>
          )}
          <button type="button" className="key" onClick={cancel}>
            {t.loading.cancel}
          </button>
        </div>
      </div>
    </main>
  );
}
