import { useT } from '../i18n/store';
import { Icon } from './Icon';
import { LanguageSelect } from './LanguageSelect';
import { useOpenProject } from './useOpenProject';

export function EmptyScreen() {
  const t = useT();
  const { open, error } = useOpenProject();
  return (
    <main className="screen">
      <div className="screen__panel cut">
        <h1>ArchViewer</h1>
        <p className="lead">{t.empty.lead}</p>
        <div className="screen__actions">
          <button type="button" className="key key--primary" onClick={() => void open()}>
            {t.open.button}
          </button>
          <LanguageSelect />
        </div>
        {error && (
          <p className="status-line status-line--error" role="alert">
            <Icon name="warning" />
            {t.open.error(error)}
          </p>
        )}
        <p className="screen__note muted">{t.empty.note}</p>
      </div>
    </main>
  );
}
