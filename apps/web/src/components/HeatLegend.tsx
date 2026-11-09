import { useT } from '../i18n/store';
import { heatLegend, type HeatColors } from '../renderer/heat';
import { useGraphStore } from '../store/graph-store';
import { renderable } from '../store/selectors';

/** Na tela, as amostras usam os próprios tokens; o SVG exportado recebe as cores já em rgb. */
const CSS_COLORS: HeatColors = {
  heat: [1, 2, 3, 4, 5].map((i) => `var(--color-heat-${i})`),
  unused: 'var(--color-unused)',
  testOnly: 'var(--color-test-only)',
  added: 'var(--color-added)',
  changed: 'var(--color-changed)',
};

/** Legenda do heatmap no canto do canvas; some quando não há métrica ativa. */
export function HeatLegend() {
  const t = useT();
  const colorBy = useGraphStore((s) => s.colorBy);
  const graph = useGraphStore((s) => s.graph);
  const filters = useGraphStore((s) => s.filters);
  const legend = heatLegend(colorBy, renderable(graph, filters).nodes, t, CSS_COLORS);
  if (!legend) return null;
  return (
    <div role="group" aria-label={legend.title} className="legend cut">
      <p className="legend__title">{legend.title}</p>
      <ul className="legend__items">
        {legend.items.map((item) => (
          <li key={item.label} className="legend__item num">
            <span className="legend__swatch" style={{ background: item.color }} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
