import { Component, type ReactNode } from 'react';
import { useT } from '../i18n/store';
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
    return this.state.failed ? <GraphUnavailable /> : this.props.children;
  }
}

function GraphUnavailable() {
  const t = useT();
  return (
    <div className="screen screen--inline">
      <div className="screen__panel cut">
        <div role="alert" className="screen__message">
          <p className="status-line status-line--error">
            <Icon name="warning" />
            {t.graph.unavailable}
          </p>
          <p>{t.graph.noWebgl}</p>
        </div>
        <div className="screen__actions">
          <button type="button" className="key key--primary" onClick={() => location.reload()}>
            {t.graph.reload}
          </button>
        </div>
      </div>
    </div>
  );
}
