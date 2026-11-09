import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useT } from '../i18n/store';
import { pickDirectory } from '../ingest/pick';
import { useGraphStore } from '../store/graph-store';
import { message } from './format';

type ItemId = 'json' | 'folder' | 'stop';

/** Menu "Comparar": escolhe a versão "antes" (JSON exportado ou outra pasta) e mostra a comparação ativa. */
export function CompareMenu() {
  const t = useT();
  const comparison = useGraphStore((s) => s.comparison);
  const phase = useGraphStore((s) => s.comparePhase);
  const compareWithExport = useGraphStore((s) => s.compareWithExport);
  const compareWithFolder = useGraphStore((s) => s.compareWithFolder);
  const clearComparison = useGraphStore((s) => s.clearComparison);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const items: ItemId[] = comparison ? ['json', 'folder', 'stop'] : ['json', 'folder'];
  const label: Record<ItemId, string> = { json: t.compare.withJson, folder: t.compare.withFolder, stop: t.compare.stop };

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

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const run = async (id: ItemId) => {
    close();
    setNote('');
    if (id === 'stop') clearComparison();
    else if (id === 'json') fileRef.current?.click();
    else {
      try {
        const picked = await pickDirectory();
        if (picked) await compareWithFolder(picked.source);
      } catch (e) {
        setNote(t.compare.failed(message(e)));
      }
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote('');
    try {
      await compareWithExport(await file.text(), file.name);
    } catch (err) {
      setNote(t.compare.failed(message(err)));
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const refs = itemRefs.current.slice(0, items.length);
    const at = refs.findIndex((el) => el === document.activeElement);
    const focus = (i: number) => refs[(i + items.length) % items.length]?.focus();
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
        focus(items.length - 1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  let feedback = note;
  if (phase.status === 'loading') feedback = t.compare.loading(phase.read, phase.total);
  else if (phase.status === 'error')
    feedback = phase.message === 'invalid' ? t.compare.invalid : t.compare.failed(phase.message);
  else if (!feedback && comparison?.warning === 'projectMismatch') feedback = t.compare.mismatch(comparison.baseProject);

  return (
    <div className="export compare" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="key"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {t.compare.button}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={t.compare.menu} className="export__menu cut" onKeyDown={onMenuKey}>
          {items.map((id, i) => (
            <button
              key={id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="export__item"
              onClick={() => void run(id)}
            >
              {label[id]}
            </button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e)} />
      {comparison && (
        <span className="compare__pill">
          {t.compare.pill(comparison.label)}
          <button type="button" className="compare__x" aria-label={t.compare.stop} onClick={clearComparison}>
            ×
          </button>
        </span>
      )}
      <p className="export__status" aria-live="polite">
        {feedback}
      </p>
    </div>
  );
}
