import { test, expect } from '@playwright/test';

const testPassphrase = 'violet harbor lantern willow';

test('organizer can complete first setup, sign out, and sign back in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/organizer');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('h1')).toBeVisible();

  if (await page.getByRole('heading', { name: 'Make NAMI yours.' }).isVisible()) {
    await page.getByLabel('Your name').fill('Stan');
    await page.locator('input[name="password"]').fill(testPassphrase);
    await page.locator('input[name="confirmation"]').fill(testPassphrase);
    await page.getByRole('button', { name: 'Set up NAMI' }).click();
    const outcome = await Promise.race([
      page.getByRole('heading', { name: 'Hello, Stan.' }).waitFor().then(() => 'signed-in'),
      page.getByRole('alert').waitFor().then(() => 'conflict'),
    ]);
    if (outcome === 'conflict') {
      // Another browser profile won the intentional one-organizer setup race.
      errors.length = 0;
      await page.reload();
      await expect(page.locator('h1')).toBeVisible();
    }
  }

  if (await page.getByRole('heading', { name: 'Welcome back.' }).isVisible()) {
    await page.getByLabel('Passphrase').fill(testPassphrase);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Hello, Stan.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByLabel('Passphrase').fill(testPassphrase);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Stan.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
