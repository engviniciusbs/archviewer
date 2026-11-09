/** Rasteriza o SVG num canvas em `scale`× e devolve o PNG. Coberto pelo e2e (o jsdom não tem canvas). */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 0);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 0);
  if (!width || !height) throw new Error('png render failed: svg without size');
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    throw new Error('png render failed: svg did not load');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('png render failed: no 2d context');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png render failed: empty blob');
  return blob;
}
