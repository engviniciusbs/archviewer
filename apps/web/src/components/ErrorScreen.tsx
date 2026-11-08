import { Icon } from './Icon';

export function ErrorScreen({ error }: { error: string | null }) {
  return (
    <main className="screen">
      <div className="screen__panel cut">
        <div role="alert" className="screen__message">
          <p className="status-line status-line--error">
            <Icon name="warning" />
            Análise interrompida
          </p>
          <h1>Algo deu errado na análise</h1>
          {error && (
            <p>
              <code className="mono screen__error">{error}</code>
            </p>
          )}
        </div>
        <p>Recarregue a página e abra o projeto de novo. Nada foi enviado para fora do navegador.</p>
        <div className="screen__actions">
          <button type="button" className="key key--primary" onClick={() => location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    </main>
  );
}
