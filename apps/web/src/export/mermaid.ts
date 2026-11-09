import type { VNode } from '@archviewer/core-wasm';
import type { Renderable } from '../store/selectors';

/** Acima disso o GitHub costuma recusar o diagrama; o texto é copiado mesmo assim. */
export const MERMAID_EDGE_WARNING = 500;

const escape = (label: string) => label.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

function shape(n: VNode): string {
  const label = escape(n.label);
  if (n.kind === 'group') return `["${label}/"]`;
  if (n.kind === 'external') return `{{"${label}"}}`;
  return `("${label}")`;
}

/** Flowchart da visão atual: o mesmo recorte (`renderable`) que o canvas desenha. */
export function toMermaid(r: Renderable): { text: string; edges: number } {
  const lines = ['flowchart LR'];
  for (const n of r.nodes) lines.push(`  n${n.id}${shape(n)}`);
  const cycleLinks: number[] = [];
  r.edges.forEach((e, i) => {
    const arrow = e.typeOnly ? '-.->' : '-->';
    const weight = e.weight > 1 ? `|${e.weight}|` : '';
    lines.push(`  n${e.from} ${arrow}${weight} n${e.to}`);
    if (e.inCycle) cycleLinks.push(i);
  });
  for (const i of cycleLinks) lines.push(`  linkStyle ${i} stroke:#d33,stroke-width:2px`);
  return { text: lines.join('\n'), edges: r.edges.length };
}
