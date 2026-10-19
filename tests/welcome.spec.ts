import { test, expect } from '@playwright/test';

test('welcome loads, explains the planned flow, and works by keyboard or touch', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toEqual({ status: 'ok', service: 'nami' });
  await page.goto('/');
  await expect(page).toHaveTitle('NAMI — memories made together');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Memories made together.');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const summary = page.locator('summary');
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (testInfo.project.name === 'desktop-chromium') {
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await summary.tap();
  }
  await expect(page.getByText('Open a private link from someone you know.')).toBeVisible();
  await expect(page.getByText('Photo sharing is still being built. There’s nothing to upload just yet.')).toBeVisible();
  await summary.click();
  await expect(page.getByText('Open a private link from someone you know.')).toBeHidden();
  expect(errors).toEqual([]);
});
