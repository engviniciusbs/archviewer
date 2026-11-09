import { describe, expect, it } from 'vitest';
import { exportFileName, slugify } from '../../src/export/filename';

describe('nomes de arquivo', () => {
  it('slug em minúsculas com hífens', () => {
    expect(slugify('My App')).toBe('my-app');
    expect(slugify('  Ação_Total!! ')).toBe('acao-total');
  });
  it('cai em project quando não sobra nada', () => {
    expect(slugify('@@@')).toBe('project');
    expect(slugify('')).toBe('project');
    expect(slugify(null)).toBe('project');
  });
  it('monta <slug>-archviewer.<ext>', () => {
    expect(exportFileName('Arch Viewer', 'png')).toBe('arch-viewer-archviewer.png');
    expect(exportFileName(null, 'json')).toBe('project-archviewer.json');
  });
});
