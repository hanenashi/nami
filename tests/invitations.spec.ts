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

test('a contributor joins, shares one JPEG, and loses access when revoked', async ({ browser, page }, testInfo) => {
  await signInAsOrganizer(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const title = `Family picnic ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  const eventName = page.getByLabel('Event name');
  if (!await eventName.isVisible()) await page.getByRole('button', { name: 'New event' }).click();
  await eventName.fill(title);
  await page.getByLabel('Date', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Description').fill('A small picnic for the invitation test.');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Create invitation' }).click();
  const inviteLink = await page.getByLabel('Invitation link').inputValue();
  expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  const guestContext = await browser.newContext(testInfo.project.use);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteLink);
  await expect(guestPage.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await guestPage.getByLabel('Your name').fill('Aunt May');
  await guestPage.getByRole('button', { name: 'Join event' }).click();
  await expect(guestPage).toHaveURL(/\/events\/[0-9a-f-]+$/);
  await expect(guestPage.getByText('Hello, Aunt May')).toBeVisible();
  await expect(guestPage.getByText('You can add photographs')).toBeVisible();
  const jpeg = await sharp({
    create: { width: 80, height: 50, channels: 3, background: { r: 34, g: 82, b: 69 } },
  }).jpeg({ quality: 88 }).toBuffer();
  await guestPage.getByLabel('Choose one JPEG').setInputFiles({
    name: 'synthetic-family-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  });
  await guestPage.getByRole('button', { name: 'Add photo' }).click();
  await expect(guestPage.getByRole('img', { name: 'Shared by Aunt May' })).toBeVisible();
  await expect(guestPage.getByRole('link', { name: /Download original/ })).toBeVisible();
  await guestPage.getByLabel('Add several JPEGs').setInputFiles([
    { name: 'batch-one.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'batch-two.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  await expect(guestPage.getByText('2 of 2 ready')).toBeVisible();
  await expect(guestPage.getByRole('img', { name: 'Shared by Aunt May' })).toHaveCount(3);

  expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const repeatContext = await browser.newContext(testInfo.project.use);
  const repeatPage = await repeatContext.newPage();
  await repeatPage.goto(inviteLink);
  await expect(repeatPage.getByText('Continue as Aunt May.')).toBeVisible();
  await repeatPage.getByRole('button', { name: 'Join event' }).click();
  await expect(repeatPage).toHaveURL(/\/events\/[0-9a-f-]+$/);
  await expect(repeatPage.getByRole('img', { name: 'Shared by Aunt May' })).toHaveCount(3);
  expect(errors).toEqual([]);

  await page.reload();
  await expect(page.getByText('Contributor · Aunt May')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Shared by Aunt May' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Contributor · Aunt May · Revoked')).toBeVisible();
  await guestPage.reload();
  await expect(guestPage.getByRole('alert')).toContainText('session is no longer active');
  await repeatPage.reload();
  await expect(repeatPage.getByRole('alert')).toContainText('session is no longer active');
  await guestContext.close();
  await repeatContext.close();
});
