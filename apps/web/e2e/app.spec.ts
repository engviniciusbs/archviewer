import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sample-project');

test('abre o sample-project e navega pela arquitetura', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Abrir projeto' }).click();
  await (await chooser).setFiles(SAMPLE);

  // Resumo na barra de status.
  const status = page.getByRole('status');
  await expect(status).toContainText('8 arquivos');
  await expect(status).toContainText('1 ciclo');
  await expect(status).toContainText('2 externos');
  await expect(
    page.getByText('Seu navegador não tem acesso direto a pastas; usando o seletor de arquivos.'),
  ).toBeVisible();

  // O grafo desenhou um canvas com tamanho real.
  const canvas = page.getByRole('main', { name: 'Grafo de dependências' }).locator('canvas').first();
  await expect(canvas).toBeAttached();
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0)
    .toBeGreaterThan(50);

  // Grupos de topo no explorador.
  const tree = page.getByRole('tree', { name: 'Arquivos do projeto' });
  const items = tree.getByRole('treeitem');
  await expect(items.first()).toBeVisible();
  const groups = tree.locator('[role="treeitem"][data-kind="group"][aria-level="1"]');
  await expect(groups.first()).toBeVisible();

  // Expande um grupo: o pai fica expandido e os filhos aparecem.
  const group = groups.first();
  const wasOpen = (await group.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const level = Number(await group.getAttribute('aria-level'));
  await expect(tree.locator(`[role="treeitem"][aria-level="${level + 1}"]`).first()).toBeVisible();

  // Seleciona lazy.ts pela busca.
  await page.getByRole('combobox', { name: 'Buscar arquivo ou pasta' }).fill('lazy.ts');
  await page.getByRole('option', { name: /lazy\.ts/ }).first().click();
  const detail = page.getByRole('complementary').or(page.locator('.panel--detail'));
  await expect(detail.getByText('src/dynamic/lazy.ts').first()).toBeVisible();
  await expect(detail.getByTestId('fan-in')).toBeVisible();
  await expect(detail.getByTestId('fan-out')).toHaveText('2');
  await expect(detail.getByRole('list', { name: 'Imports' }).getByText('dinâmico')).toHaveCount(2);

  // Não resolvidos: 1 item, motivo asset; "Ocultar assets" esconde.
  await page.getByRole('button', { name: /não resolvido/ }).click();
  const issues = page.getByRole('region', { name: 'Não resolvidos' });
  const rows = issues.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('asset');
  await page.getByRole('button', { name: 'Ocultar assets' }).click();
  await expect(issues.getByRole('table')).toHaveCount(0);
  await expect(issues.getByText('Todos os imports apontam para um arquivo ou pacote.')).toBeVisible();

  expect(problems).toEqual([]);
});
