import { useT } from '../i18n/store';
import { COLOR_BY, type ColorBy } from '../renderer/heat';
import { useGraphStore } from '../store/graph-store';

/** "Colorir por": troca a métrica do heatmap (e a URL). */
export function ColorBySelect() {
  const t = useT();
  const colorBy = useGraphStore((s) => s.colorBy);
  const setColorBy = useGraphStore((s) => s.setColorBy);
  const comparing = useGraphStore((s) => s.comparison !== null);
  return (
    <select
      className="language colorby"
      aria-label={t.heat.label}
      value={colorBy}
      onChange={(e) => setColorBy(e.target.value as ColorBy)}
    >
      {COLOR_BY.filter((c) => c !== 'changes' || comparing).map((c) => (
        <option key={c} value={c}>
          {c === 'none' ? `${t.heat.label}: ${t.heat.none}` : t.heat[c]}
        </option>
      ))}
    </select>
  );
}
