import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sample-project');

test('abre o sample-project e navega pela arquitetura', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });

  // Força o caminho <input webkitdirectory>.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });
  await page.goto('/');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open project' }).click();
  await (await chooser).setFiles(SAMPLE);

  // Resumo na barra de status.
  const status = page.getByRole('status');
  await expect(status).toContainText('8 files');
  await expect(status).toContainText('1 cycle');
  await expect(status).toContainText('2 externals');
  await expect(
    page.getByText("Your browser can't access folders directly; using the file picker."),
  ).toBeVisible();

  // O grafo desenhou um canvas com tamanho real.
  const canvas = page.getByRole('main', { name: 'Dependency graph' }).locator('canvas').first();
  await expect(canvas).toBeAttached();
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0)
    .toBeGreaterThan(50);

  // Grupos de topo no explorador.
  const tree = page.getByRole('tree', { name: 'Project files' });
  const items = tree.getByRole('treeitem');
  await expect(items.first()).toBeVisible();
  const groups = tree.locator('[role="treeitem"][data-kind="group"][aria-level="1"]');
  await expect(groups.first()).toBeVisible();

  // Expande um grupo recolhido de nível 2 (o do ciclo): aria-expanded vai de false a true
  // e os filhos aparecem um nível abaixo.
  const circular = tree.locator('[role="treeitem"][data-kind="group"][aria-level="2"]', {
    hasText: 'circular',
  });
  await expect(circular).toHaveAttribute('aria-expanded', 'false');
  await expect(tree.locator('[role="treeitem"][aria-level="3"]', { hasText: 'a.ts' })).toHaveCount(0);
  await circular.click();
  await expect(circular).toHaveAttribute('aria-expanded', 'true');
  const children = tree.locator('[role="treeitem"][aria-level="3"]');
  await expect(children.filter({ hasText: 'a.ts' })).toBeVisible();
  await expect(children.filter({ hasText: 'b.ts' })).toBeVisible();

  // Seleciona lazy.ts pela busca.
  await page.getByRole('combobox', { name: 'Search file or folder' }).fill('lazy.ts');
  await page.getByRole('option', { name: /lazy\.ts/ }).first().click();
  const detail = page.getByRole('complementary').or(page.locator('.panel--detail'));
  await expect(detail.getByText('src/dynamic/lazy.ts').first()).toBeVisible();
  await expect(detail.getByTestId('fan-in')).toBeVisible();
  await expect(detail.getByTestId('fan-out')).toHaveText('2');
  await expect(detail.getByRole('list', { name: 'Imports' }).getByText('dynamic')).toHaveCount(2);

  // Não resolvidos: 1 item, motivo asset; "Ocultar assets" esconde.
  await page.getByRole('button', { name: /unresolved/ }).click();
  const issues = page.getByRole('region', { name: 'Unresolved' });
  const rows = issues.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('asset');
  await page.getByRole('button', { name: 'Hide assets' }).click();
  await expect(issues.getByRole('table')).toHaveCount(0);
  await expect(issues.getByText('Every import points to a file or a package.')).toBeVisible();

  // Exportar: JSON completo, PNG da visão atual e Mermaid na área de transferência.
  const exportMenu = async (item: string) => {
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  const readDownload = async (item: string) => {
    const pending = page.waitForEvent('download');
    await exportMenu(item);
    const download = await pending;
    const file = await download.path();
    return { name: download.suggestedFilename(), bytes: await readFile(file) };
  };

  const json = await readDownload('Full graph (JSON)');
  expect(json.name).toBe('sample-project-archviewer.json');
  const graph = JSON.parse(json.bytes.toString('utf8'));
  expect(graph.files).toHaveLength(8);
  expect(graph.cycles).toEqual([['src/circular/a.ts', 'src/circular/b.ts']]);

  // Comparar: com o próprio export não há mudanças; com uma base sem helpers.ts, ele aparece como novo.
  const compareWith = async (file: string) => {
    await page.getByRole('button', { name: 'Compare' }).click();
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'With an exported JSON…' }).click();
    await (await picker).setFiles(file);
  };
  const same = testInfo.outputPath('same.json');
  await writeFile(same, json.bytes);
  await compareWith(same);
  await expect(page.getByText('Comparing with same.json')).toBeVisible();
  await expect(status).toContainText('0 changes');

  const helpers = 'src/utils/helpers.ts';
  const older = testInfo.outputPath('older.json');
  await writeFile(
    older,
    JSON.stringify({
      ...graph,
      files: graph.files.filter((f: { path: string }) => f.path !== helpers),
      edges: graph.edges.filter((e: { from: string; to: string }) => e.from !== helpers && e.to !== helpers),
    }),
  );
  await compareWith(older);
  await expect(page.getByText('Comparing with older.json')).toBeVisible();
  await page.getByRole('button', { name: /\d+ changes?/ }).click();
  const changes = page.getByRole('region', { name: 'Changes' });
  await expect(changes.getByRole('list', { name: 'Added files' })).toContainText(helpers);
  await changes.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(page.getByText('Comparing with older.json')).toHaveCount(0);

  const png = await readDownload('PNG image');
  expect(png.name).toBe('sample-project-archviewer.png');
  expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  await exportMenu('Mermaid diagram');
  await expect(page.getByText('Copied to the clipboard')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^flowchart LR/);

  // Heatmap por linhas: a legenda aparece e some ao voltar para "nenhum".
  const colorBy = page.getByRole('combobox', { name: 'Color by' });
  await colorBy.selectOption('loc');
  await expect(page.getByRole('group', { name: 'Lines' })).toBeVisible();
  await colorBy.selectOption('none');
  await expect(page.getByRole('group', { name: 'Lines' })).toHaveCount(0);

  // Código sem uso: o sample-project não tem entradas de produção, então cai no fallback.
  await page.getByRole('button', { name: /unused/ }).click();
  const unusedPanel = page.getByRole('region', { name: 'Unused code' });
  await expect(unusedPanel.getByRole('table', { name: 'Unused files' })).toContainText('src/index.ts');
  await expect(unusedPanel.getByText(/nobody imports it/)).toBeVisible();
  await unusedPanel.getByRole('button', { name: 'Close' }).click();

  // Troca para português: a interface e os números mudam sem reabrir o projeto.
  await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'Português' });
  await expect(status).toContainText('8 arquivos');
  await expect(page.getByRole('button', { name: 'Abrir projeto' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

  expect(problems).toEqual([]);
});
