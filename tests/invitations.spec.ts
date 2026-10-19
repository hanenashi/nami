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

test('invitation joins a guest to one event and revocation ends access', async ({ browser, page }, testInfo) => {
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

  const repeatContext = await browser.newContext(testInfo.project.use);
  const repeatPage = await repeatContext.newPage();
  await repeatPage.goto(inviteLink);
  await expect(repeatPage.getByText('Continue as Aunt May.')).toBeVisible();
  await repeatPage.getByRole('button', { name: 'Join event' }).click();
  await expect(repeatPage).toHaveURL(/\/events\/[0-9a-f-]+$/);
  expect(errors).toEqual([]);

  await page.reload();
  await expect(page.getByText('Contributor · Aunt May')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Contributor · Aunt May · Revoked')).toBeVisible();
  await guestPage.reload();
  await expect(guestPage.getByRole('alert')).toContainText('session is no longer active');
  await repeatPage.reload();
  await expect(repeatPage.getByRole('alert')).toContainText('session is no longer active');
  await guestContext.close();
  await repeatContext.close();
});
