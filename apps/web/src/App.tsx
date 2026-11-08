import { useState, useCallback } from 'react';
import { FileExplorer } from './components/FileExplorer/FileExplorer';
import { GraphView } from './components/GraphView/GraphView';
import { DetailPanel } from './components/DetailPanel/DetailPanel';
import { Toolbar } from './components/Toolbar/Toolbar';
import { StatusBar } from './components/StatusBar/StatusBar';
import { useFileSystem } from './hooks/useFileSystem';
import { useGraphData } from './hooks/useGraphData';
import type { GraphNode } from './types/graph';

export function App() {
  const { files, isLoading: filesLoading, openDirectory, directoryName } = useFileSystem();
  const { graphData, isLoading: parsingLoading, error } = useGraphData(files);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  const isLoading = filesLoading || parsingLoading;

  return (
    <div className="app">
      <Toolbar
        onOpenDirectory={openDirectory}
        directoryName={directoryName}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isLoading={isLoading}
      />
      <main className="app__main">
        <aside className="app__sidebar app__sidebar--left">
          <FileExplorer
            files={files}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeSelect}
            searchQuery={searchQuery}
          />
        </aside>
        <section className="app__graph">
          <GraphView
            graphData={graphData}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeSelect}
            searchQuery={searchQuery}
          />
        </section>
        <aside className="app__sidebar app__sidebar--right">
          <DetailPanel node={selectedNode} graphData={graphData} />
        </aside>
      </main>
      <StatusBar graphData={graphData} isLoading={isLoading} error={error} />
    </div>
  );
}
