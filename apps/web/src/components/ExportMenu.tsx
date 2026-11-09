import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { badgeMarkdown } from '../export/badge';
import { copyText, download } from '../export/deliver';
import { exportFileName } from '../export/filename';
import { MERMAID_EDGE_WARNING, toMermaid } from '../export/mermaid';
import { svgToPng } from '../export/png';
import { currentScene, hasSceneSource } from '../export/scene';
import { buildSvg } from '../export/svg';
import { useT } from '../i18n/store';
import { canvasToRgb, readTheme } from '../renderer/theme';
import { useGraphStore, useGraphStoreApi } from '../store/graph-store';
import { renderable } from '../store/selectors';
import { message } from './format';

type ItemId = 'png' | 'svg' | 'mermaid' | 'json' | 'badge';
const ITEMS: ItemId[] = ['png', 'svg', 'mermaid', 'json', 'badge'];
const STATUS_MS = 5000;

function svgOfCurrentView(): string {
  const scene = currentScene();
  if (!scene) throw new Error('no graph canvas');
  return buildSvg(scene, readTheme(document.documentElement, canvasToRgb));
}

/** Texto para copiar à mão quando a área de transferência não está disponível. */
function ManualCopy(p: { text: string; onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className="export__manual cut"
      onKeyDown={(e) => {
        if (e.key === 'Escape') p.onClose();
      }}
    >
      <h2 id={titleId} className="panel__title">
        {t.export.manualTitle}
      </h2>
      <p className="muted">{t.export.manualHint}</p>
      <textarea ref={ref} className="export__text mono" readOnly value={p.text} rows={6} />
      <div className="screen__actions">
        <button type="button" className="key key--small" onClick={p.onClose}>
          {t.export.close}
        </button>
      </div>
    </div>
  );
}

/** Menu "Exportar": imagens e Mermaid da visão atual; JSON do projeto inteiro; badge para README. */
export function ExportMenu() {
  const t = useT();
  const storeApi = useGraphStoreApi();
  const graph = useGraphStore((s) => s.graph);
  const filters = useGraphStore((s) => s.filters);
  const summary = useGraphStore((s) => s.summary);
  const projectName = useGraphStore((s) => s.projectName);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const hintId = useId();

  const view = renderable(graph, filters);
  const reason = (id: ItemId): string | null => {
    if (id === 'png' || id === 'svg') {
      if (!hasSceneSource()) return t.export.noCanvas;
      if (view.nodes.length === 0) return t.export.noGraph;
    }
    if (id === 'mermaid' && view.nodes.length === 0) return t.export.noGraph;
    return null;
  };

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const copy = async (text: string, done: string) => {
    if (await copyText(text)) setStatus(done);
    else setManual(text);
  };

  const run = async (id: ItemId) => {
    if (reason(id)) return;
    close(true);
    try {
      switch (id) {
        case 'png': {
          const name = exportFileName(projectName, 'png');
          download(await svgToPng(svgOfCurrentView()), name);
          setStatus(t.export.downloaded(name));
          break;
        }
        case 'svg': {
          const name = exportFileName(projectName, 'svg');
          download(new Blob([svgOfCurrentView()], { type: 'image/svg+xml' }), name);
          setStatus(t.export.downloaded(name));
          break;
        }
        case 'json': {
          const data = await storeApi.getState().exportGraph();
          if (!data) throw new Error('no analysis to export');
          const name = exportFileName(projectName, 'json');
          download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
          setStatus(t.export.downloaded(name));
          break;
        }
        case 'mermaid': {
          const { text, edges } = toMermaid(view);
          await copy(text, edges > MERMAID_EDGE_WARNING ? t.export.mermaidLarge(edges) : t.export.copied);
          break;
        }
        case 'badge':
          if (!summary) throw new Error('no analysis to export');
          await copy(badgeMarkdown(summary), t.export.copied);
          break;
      }
    } catch (e) {
      setStatus(t.export.failed(message(e)));
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current;
    const at = items.findIndex((el) => el === document.activeElement);
    const focus = (i: number) => items[(i + ITEMS.length) % ITEMS.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focus(at + 1);
        break;
      case 'ArrowUp':
        focus(at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(ITEMS.length - 1);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="export" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="key"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setStatus('');
          setOpen((o) => !o);
        }}
      >
        {t.export.button}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={t.export.menu} className="export__menu cut" onKeyDown={onMenuKey}>
          {ITEMS.map((id, i) => {
            const why = reason(id);
            return (
              <button
                key={id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="export__item"
                aria-disabled={why ? true : undefined}
                aria-describedby={why ? `${hintId}-${id}` : undefined}
                title={why ?? undefined}
                onClick={() => void run(id)}
              >
                {t.export[id]}
              </button>
            );
          })}
          <div className="visually-hidden">
            {ITEMS.map((id) => {
              const why = reason(id);
              return why ? (
                <span key={id} id={`${hintId}-${id}`}>
                  {why}
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}
      <p className="export__status" aria-live="polite">
        {status}
      </p>
      {manual !== null && (
        <ManualCopy
          text={manual}
          onClose={() => {
            setManual(null);
            buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
