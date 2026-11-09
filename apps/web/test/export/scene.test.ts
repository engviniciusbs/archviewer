import Graph from 'graphology';
import type Sigma from 'sigma';
import { describe, expect, it } from 'vitest';
import { currentScene, FILE_LABEL_LIMIT, registerSceneSource, sceneFromSigma } from '../../src/export/scene';

function stubSigma(g: Graph, hiddenEdge?: string) {
  return {
    getNodeDisplayData: (key: string) => ({ ...g.getNodeAttributes(key), size: 4 }),
    getEdgeDisplayData: (key: string) => ({ color: 'rgb(1, 2, 3)', size: 1, hidden: key === hiddenEdge }),
  } as unknown as Sigma;
}

describe('sceneFromSigma', () => {
  it('copia posições do layout e omite arestas escondidas pelos reducers', () => {
    const g = new Graph({ type: 'directed' });
    g.addNode('1', { x: 1, y: 2, color: 'c', label: 'a.ts', kind: 'file' });
    g.addNode('2', { x: 3, y: 4, color: 'c', label: 'src', kind: 'group', borderColor: 'b' });
    g.addNode('3', { x: 5, y: 6, color: 'c', label: 'react', kind: 'external', borderColor: 'b' });
    g.addEdgeWithKey('1->2', '1', '2');
    g.addEdgeWithKey('1->3', '1', '3');
    const scene = sceneFromSigma(stubSigma(g, '1->3'), g, false);
    expect(scene.nodes.map((n) => [n.x, n.y, n.label])).toEqual([
      [1, 2, 'a.ts'],
      [3, 4, 'src'],
      [5, 6, 'react'],
    ]);
    expect(scene.nodes[1]!.borderColor).toBe('b');
    expect(scene.edges).toEqual([{ source: 0, target: 1, size: 1, color: 'rgb(1, 2, 3)' }]);
  });

  it(`acima de ${FILE_LABEL_LIMIT} nós e sem seleção, arquivos ficam sem rótulo`, () => {
    const g = new Graph({ type: 'directed' });
    g.addNode('g', { x: 0, y: 0, color: 'c', label: 'src', kind: 'group' });
    for (let i = 0; i < FILE_LABEL_LIMIT; i++) g.addNode(`f${i}`, { x: i, y: 0, color: 'c', label: `f${i}.ts`, kind: 'file' });
    const scene = sceneFromSigma(stubSigma(g), g, false);
    expect(scene.nodes.length).toBe(FILE_LABEL_LIMIT + 1);
    expect(scene.nodes.filter((n) => n.kind === 'file').every((n) => n.label === '')).toBe(true);
    expect(scene.nodes.find((n) => n.kind === 'group')!.label).toBe('src');
    // Com seleção, os rótulos que os reducers mantiveram (seleção e vizinhos) ficam.
    expect(sceneFromSigma(stubSigma(g), g, true).nodes.find((n) => n.label === 'f0.ts')).toBeDefined();
  });
});

describe('registro da cena', () => {
  it('registra e remove a fonte', () => {
    expect(currentScene()).toBeNull();
    const off = registerSceneSource(() => ({ nodes: [], edges: [] }));
    expect(currentScene()).toEqual({ nodes: [], edges: [] });
    off();
    expect(currentScene()).toBeNull();
  });
});
