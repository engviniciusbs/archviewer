import { useState, useEffect, useRef } from 'react';
import type { FileEntry, GraphData } from '../types/graph';

export function useGraphData(files: FileEntry[]) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (files.length === 0) { setGraphData(null); return; }

    setIsLoading(true);
    setError(null);

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/parser.worker.ts', import.meta.url),
        { type: 'module' },
      );
    }

    const worker = workerRef.current;

    const handleMessage = (event: MessageEvent) => {
      const { type, data, error: workerError } = event.data;
      if (type === 'result') { setGraphData(data); setIsLoading(false); }
      else if (type === 'error') { setError(workerError); setIsLoading(false); }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage({ type: 'parse', files });

    return () => { worker.removeEventListener('message', handleMessage); };
  }, [files]);

  useEffect(() => {
    return () => { workerRef.current?.terminate(); };
  }, []);

  return { graphData, isLoading, error };
}
