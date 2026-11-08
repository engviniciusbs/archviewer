import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { GraphData, GraphNode, GraphEdge } from '../../types/graph';

interface GraphViewProps {
  graphData: GraphData | null;
  selectedNode: GraphNode | null;
  onNodeSelect: (node: GraphNode | null) => void;
  searchQuery: string;
}

export function GraphView({ graphData, selectedNode, onNodeSelect }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); });
    svg.call(zoom);

    const nodes: GraphNode[] = graphData.nodes.map(n => ({ ...n }));
    const edges: GraphEdge[] = graphData.edges.map(e => ({ ...e }));

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges as any).id((d: any) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // Arrowhead marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'var(--color-rule-2)');

    const link = g.append('g').selectAll('line').data(edges).join('line')
      .attr('stroke', (d: any) => d.circular ? 'var(--color-accent)' : 'var(--color-rule-2)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', (d: any) => d.circular ? '4 2' : 'none')
      .attr('marker-end', 'url(#arrow)');

    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .style('cursor', 'pointer')
      .on('click', (_event: any, d: any) => { onNodeSelect(d); })
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event: any, d: any) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }) as any
      );

    node.append('rect')
      .attr('width', (d: any) => Math.max(d.id.split('/').pop()!.length * 8 + 16, 60))
      .attr('height', 28)
      .attr('x', (d: any) => -Math.max(d.id.split('/').pop()!.length * 8 + 16, 60) / 2)
      .attr('y', -14)
      .attr('fill', 'var(--color-paper-2)')
      .attr('stroke', (d: any) => d.type === 'external' ? 'var(--color-muted)' : 'var(--color-rule)')
      .attr('stroke-width', 1);

    node.append('text')
      .text((d: any) => d.id.split('/').pop() ?? d.id)
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('fill', (d: any) => d.type === 'external' ? 'var(--color-muted)' : 'var(--color-ink)')
      .attr('font-size', '11px').attr('font-family', 'var(--font-body)');

    simulation.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    if (selectedNode) {
      node.select('rect')
        .attr('stroke', (d: any) => d.id === selectedNode.id ? 'var(--color-accent)' : d.type === 'external' ? 'var(--color-muted)' : 'var(--color-rule)')
        .attr('fill', (d: any) => d.id === selectedNode.id ? 'var(--color-accent-wash)' : 'var(--color-paper-2)');
    }

    return () => { simulation.stop(); };
  }, [graphData, selectedNode, onNodeSelect]);

  if (!graphData) {
    return (
      <div className="graph-view graph-view--empty" ref={containerRef}>
        <div className="graph-view__placeholder"><p>$ open a project to visualize</p></div>
      </div>
    );
  }

  return (
    <div className="graph-view" ref={containerRef}>
      <svg ref={svgRef} className="graph-view__svg" />
    </div>
  );
}
