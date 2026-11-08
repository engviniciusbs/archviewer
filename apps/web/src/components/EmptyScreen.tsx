import { Icon } from './Icon';
import { useOpenProject } from './useOpenProject';

export function EmptyScreen() {
  const { open, error } = useOpenProject();
  return (
    <main className="screen">
      <div className="screen__panel cut">
        <h1>ArchViewer</h1>
        <p className="lead">
          Veja a arquitetura de um projeto JavaScript ou TypeScript como um grafo. A pasta é lida no navegador e nada
          sai da sua máquina.
        </p>
        <div className="screen__actions">
          <button type="button" className="key key--primary" onClick={() => void open()}>
            Abrir projeto
          </button>
        </div>
        {error && (
          <p className="status-line status-line--error" role="alert">
            <Icon name="warning" />
            Não foi possível abrir a pasta: {error}
          </p>
        )}
        <p className="screen__note muted">
          Funciona melhor no Chrome e no Edge. No Firefox e no Safari, o ArchViewer usa o seletor de arquivos.
        </p>
      </div>
    </main>
  );
}
