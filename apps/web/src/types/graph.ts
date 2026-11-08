export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

export interface GraphNode {
  id: string;
  path: string;
  type: 'file' | 'external' | 'unresolved';
  language: string;
  exports: string[];
  loc: number;
  parseError?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  imports: string[];
  type: 'named' | 'default' | 'namespace' | 'commonjs' | 'dynamic' | 'sideEffect';
  circular: boolean;
}

export interface GraphMetadata {
  totalFiles: number;
  totalEdges: number;
  parseTimeMs: number;
  errors: ParseError[];
}

export interface ParseError {
  file: string;
  message: string;
  line: number;
  column: number;
}

export interface FileEntry {
  path: string;
  content: string;
}
