import { useMemo } from 'react';
import type { FileEntry, GraphNode } from '../../types/graph';

interface FileExplorerProps {
  files: FileEntry[];
  selectedNode: GraphNode | null;
  onNodeSelect: (node: GraphNode | null) => void;
  searchQuery: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

export function FileExplorer({ files, selectedNode, onNodeSelect, searchQuery }: FileExplorerProps) {
  const tree = useMemo(() => buildTree(files, searchQuery), [files, searchQuery]);

  if (files.length === 0) {
    return (
      <div className="file-explorer file-explorer--empty">
        <p className="file-explorer__hint"><span className="toolbar__muted">$</span> open a project to explore</p>
      </div>
    );
  }

  return (
    <nav className="file-explorer" aria-label="File explorer">
      <TreeNodeView node={tree} selectedPath={selectedNode?.id ?? null} onSelect={(path) => {
        onNodeSelect({ id: path, path, type: 'file', language: '', exports: [], loc: 0 });
      }} depth={0} />
    </nav>
  );
}

function TreeNodeView({ node, selectedPath, onSelect, depth }: {
  node: TreeNode; selectedPath: string | null; onSelect: (path: string) => void; depth: number;
}) {
  if (node.isFile) {
    const isSelected = node.path === selectedPath;
    return (
      <button
        className={`file-explorer__item ${isSelected ? 'file-explorer__item--selected' : ''}`}
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div className="file-explorer__dir">
      <div className="file-explorer__dir-name" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        {node.name}/
      </div>
      {node.children.map(child => (
        <TreeNodeView key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function buildTree(files: FileEntry[], searchQuery: string): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], isFile: false };
  const lowerQuery = searchQuery.toLowerCase();

  for (const file of files) {
    if (lowerQuery && !file.path.toLowerCase().includes(lowerQuery)) continue;
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({ name: part, path: file.path, children: [], isFile: true });
      } else {
        let child = current.children.find(c => c.name === part && !c.isFile);
        if (!child) {
          child = { name: part, path: parts.slice(0, i + 1).join('/'), children: [], isFile: false };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}
