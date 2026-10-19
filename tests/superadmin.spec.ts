import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { buildApp } from '../apps/api/src/app.js';
import { setSuperadminPassphrase } from '../apps/api/src/superadmin.js';

test('owner can manage people and recover the organizer in the browser', async ({ page }, testInfo) => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'nami-owner-browser-'));
  const app = await buildApp({ dataRoot, webRoot: resolve('apps/web/dist') });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const origin = { host: new URL(address).host, origin: address };
    await page.goto(`${address}/superadmin`);
    await expect(page.getByRole('heading', { name: 'Private access first.' })).toBeVisible();
    await setSuperadminPassphrase(dataRoot, 'owner browser test passphrase');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Superadmin.' })).toBeVisible();
    await page.getByLabel('Superadmin passphrase').fill('owner browser test passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'People in NAMI.' })).toBeVisible();

    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: origin,
      payload: { displayName: 'Organizer', password: 'initial organizer passphrase' } });
    const cookie = String(setup.headers['set-cookie']).split(';', 1)[0];
    const event = await app.inject({ method: 'POST', url: '/api/events', headers: { ...origin, cookie },
      payload: { title: 'Family evening', startDate: '2026-10-19' } });
    const eventId = event.json().event.id as string;
    const invitation = await app.inject({ method: 'POST', url: `/api/events/${eventId}/invitations`,
      headers: { ...origin, cookie }, payload: { role: 'viewer' } });
    const secret = (invitation.json().invitePath as string).split('/').at(-1)!;
    const guest = await app.inject({ method: 'POST', url: `/api/invitations/${secret}/redeem`,
      headers: origin, payload: { nickname: 'Aunt May' } });
    const guestCookie = String(guest.headers['set-cookie']).split(';', 1)[0];

    await page.reload();
    const organizerCard = page.locator('.person-card').filter({ hasText: 'Organizer' });
    const guestCard = page.locator('.person-card').filter({ hasText: 'Aunt May' });
    await expect(organizerCard).toContainText('Family evening · organizer');
    await expect(guestCard).toContainText('Family evening · viewer');
    if (testInfo.project.name === 'iphone-webkit') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: '/tmp/nami-iphone-superadmin.png', fullPage: true });
    }
    page.once('dialog', dialog => dialog.accept());
    await guestCard.getByRole('button', { name: 'Disable guest access' }).click();
    await expect(guestCard).toContainText('No current event access');
    assertStatus(await app.inject({ url: `/api/events/${eventId}`, headers: { cookie: guestCookie } }), 401);
    page.once('dialog', dialog => dialog.accept('Aunt May'));
    await guestCard.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(guestCard).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Aunt May was permanently deleted');

    await page.getByText('Reset organizer passphrase').click();
    await page.getByLabel('New organizer passphrase').fill('replacement organizer passphrase');
    await page.getByLabel('Repeat new passphrase').fill('replacement organizer passphrase');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset passphrase' }).click();
    await expect(page.getByRole('status')).toContainText('Organizer passphrase changed');
    assertStatus(await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin,
      payload: { password: 'initial organizer passphrase' } }), 401);
    assertStatus(await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin,
      payload: { password: 'replacement organizer passphrase' } }), 200);
  } finally {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

function assertStatus(response: { statusCode: number }, expected: number) {
  expect(response.statusCode).toBe(expected);
}
