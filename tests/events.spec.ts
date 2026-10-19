import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const testPassphrase = 'violet harbor lantern willow';

async function signInAsOrganizer(page: Page) {
  await page.goto('/organizer');
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
      await page.reload();
      await expect(page.locator('h1')).toBeVisible();
    }
  }
  if (await page.getByRole('heading', { name: 'Welcome back.' }).isVisible()) {
    await page.getByLabel('Passphrase').fill(testPassphrase);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Hello, Stan.' })).toBeVisible();
}

test('organizer can create, view, and revisit an event', async ({ page }, testInfo) => {
  await signInAsOrganizer(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const title = `Autumn lunch ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  const eventName = page.getByLabel('Event name');
  if (!await eventName.isVisible()) await page.getByRole('button', { name: 'New event' }).click();
  await eventName.fill(title);
  await page.getByLabel('Date', { exact: true }).fill('2026-10-19');
  await page.getByLabel('End date').fill('2026-10-20');
  await page.getByLabel('Description').fill('Soup, stories, and photographs.');
  await page.getByRole('button', { name: 'Create event' }).click();

  await expect(page).toHaveURL(/\/organizer\/events\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('Soup, stories, and photographs.')).toBeVisible();
  await page.getByRole('link', { name: '← Your events' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
