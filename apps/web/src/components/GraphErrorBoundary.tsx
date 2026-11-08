import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Sem WebGL, `new Sigma` lança dentro de um efeito e o React desmontaria a página inteira.
 * A fronteira troca só a área do grafo por um aviso com "Recarregar"; o resto do shell segue.
 */
export class GraphErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen screen--inline">
        <div className="screen__panel cut">
          <div role="alert" className="screen__message">
            <p className="status-line status-line--error">
              <Icon name="warning" />
              Grafo indisponível
            </p>
            <p>Seu navegador não conseguiu iniciar o WebGL, necessário para desenhar o grafo.</p>
          </div>
          <div className="screen__actions">
            <button type="button" className="key key--primary" onClick={() => location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
