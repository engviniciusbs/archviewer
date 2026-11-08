import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { SearchHit } from '@archviewer/core-wasm';
import { useGraphStore, type Filters } from '../store/graph-store';
import { Icon } from './Icon';
import { useOpenProject } from './useOpenProject';

const SEARCH_DEBOUNCE_MS = 150;

const FILTERS: { key: keyof Filters; label: string }[] = [
  { key: 'hideExternals', label: 'Ocultar externos' },
  { key: 'hideTypeOnly', label: 'Ocultar só tipos' },
  { key: 'hideAssets', label: 'Ocultar assets' },
  { key: 'cyclesOnly', label: 'Só ciclos' },
];

function SearchBox() {
  const search = useGraphStore((s) => s.search);
  const results = useGraphStore((s) => s.searchResults);
  const setResults = useGraphStore((s) => s.setSearchResults);
  const reveal = useGraphStore((s) => s.reveal);
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [seen, setSeen] = useState(results);

  // Resultados novos zeram o item ativo; a busca limpa por fora (explorador) limpa o campo.
  if (results !== seen) {
    setSeen(results);
    setActive(-1);
    if (results === null) setText('');
  }

  useEffect(() => {
    const q = text.trim();
    let live = true;
    const t = setTimeout(async () => {
      if (!q) {
        setResults(null);
        return;
      }
      const hits = await search(q);
      if (live) setResults({ query: q, hits });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, search, setResults]);

  const hits = results?.hits ?? [];
  const expanded = open && hits.length > 0;

  const pick = (hit: SearchHit) => {
    setResults(null);
    setText('');
    setOpen(false);
    void reveal(hit);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && hits.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp' && hits.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && expanded) {
      e.preventDefault();
      pick(hits[Math.max(active, 0)]!);
    } else if (e.key === 'Escape') {
      if (expanded) setOpen(false);
      else setText('');
    }
  };

  return (
    <div className="search">
      <Icon name="search" className="search__icon" />
      <input
        className="search__input"
        type="search"
        name="q"
        role="combobox"
        aria-label="Buscar arquivo ou pasta"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="src/components"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Resultados da busca" className="search__list cut" hidden={!expanded}>
        {expanded &&
          hits.map((h, i) => (
            <li
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="search__option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <span className="search__label">{h.label}</span>
              <code className="mono search__path">{h.path}</code>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function Toolbar() {
  const filters = useGraphStore((s) => s.filters);
  const setFilter = useGraphStore((s) => s.setFilter);
  const projectName = useGraphStore((s) => s.projectName);
  const { open, error } = useOpenProject();

  return (
    <header className="toolbar">
      <p className="toolbar__brand">
        <span className="wordmark">ArchViewer</span>
        {projectName && <span className="toolbar__project">{projectName}</span>}
      </p>
      <SearchBox />
      <div className="tray" role="group" aria-label="Filtros">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="key key--tray"
            aria-pressed={filters[f.key]}
            onClick={() => setFilter(f.key, !filters[f.key])}
          >
            {f.label}
          </button>
        ))}
      </div>
      <button type="button" className="key key--primary toolbar__open" onClick={() => void open()}>
        Abrir projeto
      </button>
      {error && (
        <p className="toolbar__error" role="alert">
          <Icon name="warning" />
          Não foi possível abrir a pasta: {error}
        </p>
      )}
    </header>
  );
}
