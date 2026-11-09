import { useT } from '../i18n/store';
import { Icon } from './Icon';

export function ErrorScreen({ error }: { error: string | null }) {
  const t = useT();
  return (
    <main className="screen">
      <div className="screen__panel cut">
        <div role="alert" className="screen__message">
          <p className="status-line status-line--error">
            <Icon name="warning" />
            {t.error.badge}
          </p>
          <h1>{t.error.title}</h1>
          {error && (
            <p>
              <code className="mono screen__error">{error}</code>
            </p>
          )}
        </div>
        <p>{t.error.hint}</p>
        <div className="screen__actions">
          <button type="button" className="key key--primary" onClick={() => location.reload()}>
            {t.error.reload}
          </button>
        </div>
      </div>
    </main>
  );
}
