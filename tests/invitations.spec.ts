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

  await page.getByRole('link', { name: 'Invite people' }).click();
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
  await expect(guestPage.getByText('0 photos')).toBeVisible();
  const jpeg = await sharp({
    create: { width: 80, height: 50, channels: 3, background: { r: 34, g: 82, b: 69 } },
  }).jpeg({ quality: 88 }).toBuffer();
  const fileChooser = guestPage.waitForEvent('filechooser');
  await guestPage.getByLabel('Add photos').click();
  await (await fileChooser).setFiles({
    name: 'synthetic-family-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  });
  await expect(guestPage.getByRole('button', { name: /Open photo 1 of 1/ })).toBeVisible();
  await guestPage.getByLabel('Add photos').setInputFiles([
    { name: 'batch-one.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'batch-two.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  await expect(guestPage.getByRole('button', { name: /Open photo/ })).toHaveCount(3);
  await expect(guestPage.getByText('3 photos')).toBeVisible();
  if (testInfo.project.name !== 'desktop-chromium') await guestPage.screenshot({ path: `/tmp/nami-${testInfo.project.name}-album.png`, fullPage: true });
  await guestPage.getByRole('button', { name: /Open photo 1 of 3/ }).click();
  await expect(guestPage.getByRole('dialog', { name: 'Photo 1 of 3' })).toBeVisible();
  await expect(guestPage.getByRole('link', { name: 'Download original' })).toBeVisible();
  if (testInfo.project.name === 'iphone-webkit') {
    await guestPage.screenshot({ path: '/tmp/nami-iphone-viewer.png' });
    await guestPage.evaluate(() => {
      const stage = document.querySelector('.viewer-stage')!;
      for (const [type, x] of [['touchstart', 300], ['touchend', 70]] as const) {
        const touch = { clientX: x, clientY: 200 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] });
        Object.defineProperty(event, 'changedTouches', { value: [touch] });
        stage.dispatchEvent(event);
      }
    });
    await expect(guestPage.getByRole('dialog', { name: 'Photo 2 of 3' })).toBeVisible();
    await guestPage.keyboard.press('ArrowLeft');
    await guestPage.evaluate(() => {
      const stage = document.querySelector('.viewer-stage')!;
      for (let tap = 0; tap < 2; tap++) {
        const touch = { clientX: 150, clientY: 200 };
        for (const type of ['touchstart', 'touchend']) {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] });
          Object.defineProperty(event, 'changedTouches', { value: [touch] });
          stage.dispatchEvent(event);
        }
      }
    });
    await expect(guestPage.locator('.viewer-stage img')).toHaveAttribute('style', /scale\(2\)/);
  }
  await guestPage.keyboard.press('ArrowRight');
  await expect(guestPage.getByRole('dialog', { name: 'Photo 2 of 3' })).toBeVisible();
  await guestPage.keyboard.press('Escape');
  await expect(guestPage.getByRole('dialog')).toHaveCount(0);
  await expect(guestPage.getByRole('button', { name: /Open photo 1 of 3/ })).toBeFocused();

  expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (testInfo.project.name === 'iphone-webkit') {
    await guestPage.setViewportSize({ width: 320, height: 700 });
    expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await guestPage.screenshot({ path: '/tmp/nami-narrow-album.png', fullPage: true });
  }

  const repeatContext = await browser.newContext(testInfo.project.use);
  const repeatPage = await repeatContext.newPage();
  await repeatPage.goto(inviteLink);
  await expect(repeatPage.getByText('Continue as Aunt May.')).toBeVisible();
  await repeatPage.getByRole('button', { name: 'Join event' }).click();
  await expect(repeatPage).toHaveURL(/\/events\/[0-9a-f-]+$/);
  await expect(repeatPage.getByRole('button', { name: /Open photo/ })).toHaveCount(3);
  expect(errors).toEqual([]);

  await page.reload();
  await page.getByRole('link', { name: 'Invite people' }).click();
  await expect(page.getByText('Contributor · Aunt May')).toBeVisible();
  await expect(page.getByRole('button', { name: /Open photo/ })).toHaveCount(3);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Contributor · Aunt May · Revoked')).toBeVisible();
  await guestPage.reload();
  await expect(guestPage.getByRole('alert')).toContainText('session is no longer active');
  await repeatPage.reload();
  await expect(repeatPage.getByRole('alert')).toContainText('session is no longer active');
  await guestContext.close();
  await repeatContext.close();
});
