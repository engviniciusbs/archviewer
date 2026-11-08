import { useCallback, useState } from 'react';
import { pickDirectory } from '../ingest/pick';
import { useGraphStore } from '../store/graph-store';
import { message } from './format';

/** Escolhe uma pasta e abre o projeto; cancelar o seletor não faz nada. */
export function useOpenProject() {
  const openProject = useGraphStore((s) => s.openProject);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    setError(null);
    try {
      const picked = await pickDirectory();
      if (!picked) return;
      await openProject(picked.source, picked.fallback);
    } catch (e) {
      setError(message(e));
    }
  }, [openProject]);
  return { open, error };
}
