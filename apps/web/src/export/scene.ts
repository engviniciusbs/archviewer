import type Graph from 'graphology';
import type Sigma from 'sigma';

/** Acima disso, sem seleção, os rótulos de arquivo viram borrão na imagem. */
export const FILE_LABEL_LIMIT = 300;

export type SceneNode = {
  x: number;
  y: number;
  size: number;
  color: string;
  borderColor?: string;
  label: string;
  kind: 'group' | 'file' | 'external';
};

/** `source` e `target` são índices em `Scene.nodes`. */
export type SceneEdge = { source: number; target: number; size: number; color: string };

export type Scene = { nodes: SceneNode[]; edges: SceneEdge[] };

/**
 * O que o Sigma está desenhando agora: posições do layout (graphology) e o visual depois dos
 * reducers, para a imagem sair igual à tela, com destaque de seleção e arestas escondidas.
 */
export function sceneFromSigma(sigma: Sigma, graph: Graph, hasSelection: boolean): Scene {
  const index = new Map<string, number>();
  const nodes: SceneNode[] = [];
  const many = graph.order > FILE_LABEL_LIMIT;
  graph.forEachNode((key, attrs) => {
    const d = sigma.getNodeDisplayData(key) as (Record<string, unknown> & { hidden?: boolean }) | undefined;
    if (!d || d.hidden) return;
    const kind = (attrs.kind as SceneNode['kind']) ?? 'file';
    const label = typeof d.label === 'string' ? d.label : '';
    index.set(key, nodes.length);
    nodes.push({
      x: attrs.x as number,
      y: attrs.y as number,
      size: d.size as number,
      color: d.color as string,
      borderColor: typeof d.borderColor === 'string' ? d.borderColor : undefined,
      label: kind === 'file' && many && !hasSelection ? '' : label,
      kind,
    });
  });
  const edges: SceneEdge[] = [];
  graph.forEachEdge((key, _attrs, source, target) => {
    const d = sigma.getEdgeDisplayData(key);
    const s = index.get(source);
    const t = index.get(target);
    if (!d || d.hidden || s === undefined || t === undefined) return;
    edges.push({ source: s, target: t, size: d.size, color: d.color });
  });
  return { nodes, edges };
}

let source: (() => Scene) | null = null;

/** O `GraphCanvas` registra quem lê a cena; o menu de exportação consulta. Devolve o "desregistrar". */
export function registerSceneSource(fn: () => Scene): () => void {
  source = fn;
  return () => {
    if (source === fn) source = null;
  };
}

/** Cena atual, ou null sem canvas (WebGL indisponível ou grafo ainda não montado). */
export function currentScene(): Scene | null {
  return source ? source() : null;
}
