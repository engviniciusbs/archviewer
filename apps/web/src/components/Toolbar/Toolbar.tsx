interface ToolbarProps {
  onOpenDirectory: () => void;
  directoryName: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
}

export function Toolbar({ onOpenDirectory, directoryName, searchQuery, onSearchChange, isLoading }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <span className="toolbar__prompt">$</span>
        <span className="toolbar__brand">archviewer</span>
        {directoryName && (
          <span className="toolbar__dir">
            <span className="toolbar__muted">~/</span>{directoryName}
          </span>
        )}
      </div>
      <div className="toolbar__center">
        <input
          type="text"
          className="toolbar__search"
          placeholder="search files..."
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          aria-label="Search files"
        />
      </div>
      <div className="toolbar__right">
        <button className="btn btn--primary" onClick={onOpenDirectory} disabled={isLoading}>
          {isLoading ? 'parsing...' : 'open project'}
        </button>
      </div>
    </header>
  );
}
