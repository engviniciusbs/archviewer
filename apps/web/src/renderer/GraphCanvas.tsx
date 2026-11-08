import { useEffect, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeBorderProgram } from '@sigma/node-border';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useGraphStore, useGraphStoreApi } from '../store/graph-store';
import { renderable } from '../store/selectors';
import { PositionCache } from './positions';
import { nodeKey, syncGraph } from './sync';
import { canvasToRgb, readTheme, type GraphTheme } from './theme';

const INITIAL_LAYOUT_MS = 2000;
const INCREMENTAL_LAYOUT_MS = 800;

type Engine = {
  graph: Graph;
  sigma: Sigma;
  theme: GraphTheme;
  cache: PositionCache;
  layout: FA2Layout | null;
  timer: ReturnType<typeof setTimeout> | null;
  selected: { current: number | null };
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function shortDuration(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-short').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : 220;
}

/** Para e destrói o layout atual; só uma instância existe por vez. */
function stopLayout(e: Engine, capture: boolean): void {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  const layout = e.layout;
  e.layout = null;
  if (!layout) return;
  layout.stop();
  layout.kill();
  if (capture) e.cache.capture(e.graph);
}

function runLayout(e: Engine, durationMs: number, pinned: Set<string>): void {
  stopLayout(e, true);
  const { graph } = e;
  if (graph.order < 2) return;
  graph.forEachNode((key) => graph.setNodeAttribute(key, 'fixed', pinned.has(key)));
  const layout = new FA2Layout(graph, { settings: forceAtlas2.inferSettings(graph) });
  e.layout = layout;
  layout.start();
  e.timer = setTimeout(() => {
    if (e.layout !== layout) return;
    stopLayout(e, true);
    graph.forEachNode((key) => graph.setNodeAttribute(key, 'fixed', false));
    e.sigma.refresh();
  }, durationMs);
}

export function GraphCanvas() {
  const storeApi = useGraphStoreApi();
  const vgraph = useGraphStore((s) => s.graph);
  const filters = useGraphStore((s) => s.filters);
  const selected = useGraphStore((s) => s.selected);
  const focusRequest = useGraphStore((s) => s.focusRequest);

  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const selectedRef = useRef<number | null>(selected);
  const lastFocusSeq = useRef(focusRequest?.seq ?? 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const theme = readTheme(document.documentElement, canvasToRgb);
    const graph = new Graph({ multi: false, type: 'directed' });
    const selectedHolder = selectedRef;

    const sigma = new Sigma(graph, host, {
      nodeProgramClasses: { border: NodeBorderProgram },
      labelRenderedSizeThreshold: 8,
      labelFont: theme.labelFont,
      labelColor: { color: theme.ink },
      renderEdgeLabels: false,
      defaultEdgeColor: theme.rule2,
      defaultNodeColor: theme.ink2,
      nodeReducer: (key, data) => {
        const sel = selectedHolder.current;
        if (sel === null) return data;
        const selKey = nodeKey(sel);
        if (!graph.hasNode(selKey)) return data;
        if (key === selKey) {
          return data.type === 'border'
            ? { ...data, color: theme.accent, borderColor: theme.accent, zIndex: 2 }
            : { ...data, color: theme.accent, zIndex: 2 };
        }
        if (graph.areNeighbors(selKey, key)) return data;
        return { ...data, color: theme.rule, borderColor: theme.rule, label: '' };
      },
      edgeReducer: (key, data) => {
        const sel = selectedHolder.current;
        if (sel === null) return data;
        const selKey = nodeKey(sel);
        if (!graph.hasNode(selKey)) return data;
        return graph.source(key) === selKey || graph.target(key) === selKey ? data : { ...data, hidden: true };
      },
    });

    sigma.on('clickNode', ({ node }) => {
      void storeApi.getState().select(graph.getNodeAttribute(node, 'nodeId') as number);
    });
    sigma.on('clickStage', () => {
      void storeApi.getState().select(null);
    });
    sigma.on('doubleClickNode', ({ node, preventSigmaDefault }) => {
      preventSigmaDefault();
      const a = graph.getNodeAttributes(node);
      if (a.expandable || a.expanded) void storeApi.getState().toggle(a.nodeId as number);
    });

    engineRef.current = { graph, sigma, theme, cache: new PositionCache(), layout: null, timer: null, selected: selectedHolder };
    // O efeito de sincronização abaixo roda logo depois deste e desenha o grafo atual.
    return () => {
      const e = engineRef.current;
      engineRef.current = null;
      if (e) stopLayout(e, false);
      sigma.kill();
    };
  }, [storeApi]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const first = e.graph.order === 0;
    const existing = new Set(e.graph.nodes());
    const { added } = syncGraph(e.graph, renderable(vgraph, filters), e.cache, e.theme);
    if (added.length > 0) {
      runLayout(e, first ? INITIAL_LAYOUT_MS : INCREMENTAL_LAYOUT_MS, first ? new Set() : existing);
    }
    e.sigma.refresh();
  }, [vgraph, filters, storeApi]);

  useEffect(() => {
    selectedRef.current = selected;
    engineRef.current?.sigma.refresh();
  }, [selected]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !focusRequest || focusRequest.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusRequest.seq;
    const key = nodeKey(focusRequest.id);
    if (!e.graph.hasNode(key)) return;
    const pos = e.sigma.getNodeDisplayData(key);
    if (!pos) return;
    const camera = e.sigma.getCamera();
    const target = { x: pos.x, y: pos.y, ratio: Math.min(camera.ratio, 0.5) };
    if (prefersReducedMotion()) camera.setState(target);
    else void camera.animate(target, { duration: shortDuration() });
  }, [focusRequest]);

  return <div ref={hostRef} data-testid="graph-canvas" style={{ width: '100%', height: '100%', minHeight: 0, background: 'var(--color-paper)' }} />;
}
