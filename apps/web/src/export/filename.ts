/** Nome de projeto em slug: minúsculas, sem acentos, só `[a-z0-9-]`; `project` quando não sobra nada. */
export function slugify(name: string | null): string {
  const slug = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function exportFileName(project: string | null, ext: 'png' | 'svg' | 'json'): string {
  return `${slugify(project)}-archviewer.${ext}`;
}
