import type Graph from 'graphology';

export type Point = { x: number; y: number };

/** Posições conhecidas por id, para que recolher e expandir devolva cada nó ao lugar de antes. */
export class PositionCache {
  private readonly map = new Map<number, Point>();

  get(id: number): Point | undefined {
    return this.map.get(id);
  }

  set(id: number, x: number, y: number): void {
    this.map.set(id, { x, y });
  }

  capture(g: Graph): void {
    g.forEachNode((_key, attrs) => {
      const id = attrs.nodeId as number | undefined;
      if (id !== undefined) this.set(id, attrs.x as number, attrs.y as number);
    });
  }
}

/** Distribui os filhos num círculo em volta do pai; só depende dos ids, não da ordem de entrada. */
export function placeChildren(parent: Point, childIds: number[]): Map<number, Point> {
  const ids = [...childIds].sort((a, b) => a - b);
  const out = new Map<number, Point>();
  if (ids.length === 0) return out;
  const radius = 10 + 4 * Math.sqrt(ids.length);
  const offset = ((ids[0] * 137.5) % 360) * (Math.PI / 180);
  ids.forEach((id, i) => {
    const angle = offset + (2 * Math.PI * i) / ids.length;
    out.set(id, { x: parent.x + radius * Math.cos(angle), y: parent.y + radius * Math.sin(angle) });
  });
  return out;
}
