import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Painel lateral do shell. Acima de 60rem fica sempre aberto (o botão some via CSS);
 * abaixo, vira uma disclosure recolhível.
 */
export function Panel(p: { title: string; className: string; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className={`panel cut ${p.className}`} aria-labelledby={titleId} data-open={open}>
      <div className="panel__head">
        <h2 id={titleId} className="panel__title">
          {p.title}
        </h2>
        {p.actions}
        <button
          type="button"
          className="panel__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron" />
          <span className="visually-hidden">{open ? `Recolher ${p.title.toLowerCase()}` : `Mostrar ${p.title.toLowerCase()}`}</span>
        </button>
      </div>
      <div id={bodyId} className="panel__body">
        {p.children}
      </div>
    </section>
  );
}
