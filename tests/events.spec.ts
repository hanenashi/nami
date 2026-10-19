import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

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

test('organizer can select photos and double-confirm event removal', async ({ page }, testInfo) => {
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
  await page.getByRole('link', { name: title }).click();
  const jpeg = await sharp({ create: { width: 80, height: 60, channels: 3,
    background: { r: 38, g: 84, b: 70 } } }).jpeg().toBuffer();
  await page.getByLabel('Add photos').setInputFiles([
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  await expect(page.getByRole('button', { name: /Open photo/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByText('0 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Select photo 1 of 2' }).click();
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select photo 2 of 2' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Remove selected' }).click();
  await expect(page.getByText('Remove 1 photo from this event?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep photos' }).click();
  await expect(page.getByRole('button', { name: 'Select photo 1 of 2' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove selected' }).click();
  await page.getByRole('button', { name: 'Yes, remove 1' }).click();
  await expect(page.getByRole('button', { name: /Open photo/ })).toHaveCount(1);
  await page.getByText('Event settings').click();
  await page.getByRole('button', { name: 'Delete event…' }).click();
  const finalDelete = page.getByRole('button', { name: 'Delete event permanently' });
  await expect(finalDelete).toBeDisabled();
  await page.getByLabel('Type the event name to confirm').fill(title);
  await expect(finalDelete).toBeDisabled();
  await page.getByLabel('I understand the photos and invitations will be removed.').check();
  await expect(finalDelete).toBeEnabled();
  await finalDelete.click();
  await expect(page).toHaveURL(/\/organizer$/);
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
