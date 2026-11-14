import { expect, test, type Page } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  ensureAccount,
  holdsKey,
  hydrated,
  secondBrowser,
  signOut,
  signedIn,
  trySignIn,
} from './helpers';

/**
 * An account's key on a device (DESIGN.md §5.3), in a browser: the password that signs in also unlocks, with nobody else there; a device it cannot
 * unlock asks another, which allows it; signing out takes the key off the device.
 */

const locked = (page: Page) => page.getByRole('region', { name: 'This device is locked' });

test('the password that signs in unlocks a new device by itself, with no other device there', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await expect.poll(() => holdsKey(page)).toBe(true);
  const keys = (await (await page.request.get('/api/keys')).json()) as {
    accountKey: { version: number } | null;
  };
  expect(keys.accountKey).not.toBeNull();
  await page.context().close();

  // A second browser, the first closed: it signs in, and is unlocked at once, with nothing to answer.
  await using other = await secondBrowser(browser);
  await trySignIn(other.page, EMAIL, PASSWORD);
  await expect(other.page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await expect.poll(() => holdsKey(other.page)).toBe(true);
  await expect(locked(other.page)).toHaveCount(0);
});

test('a device the password cannot unlock asks another, and is unlocked once that one allows it', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await expect.poll(() => holdsKey(page)).toBe(true);

  await using phone = await secondBrowser(browser);
  // This device is told of no password wrap, as one whose password was reset by email: its sign-in cannot unlock.
  await phone.page.route('**/api/keys', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reply = await route.fetch();
    const body = (await reply.json()) as { wraps: { method: string }[] };
    await route.fulfill({
      response: reply,
      json: { ...body, wraps: body.wraps.filter((w) => w.method !== 'password') },
    });
  });
  await trySignIn(phone.page, EMAIL, PASSWORD);
  await expect(locked(phone.page)).toBeVisible();
  expect(await holdsKey(phone.page)).toBe(false);
  await hydrated(phone.page);
  await phone.page.getByRole('button', { name: 'Ask another device' }).click();
  await expect(phone.page.getByText('Waiting for another of your devices')).toBeVisible();

  // The first device, unlocked, is asked when it next looks (here, a reload).
  await page.reload();
  const ask = page.getByRole('dialog', { name: 'Allow your new device to open your groups?' });
  // The key gate asks once its look at the server, and the exchange of group keys, is done.
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await ask.getByRole('button', { name: 'Allow' }).click();

  await expect.poll(() => holdsKey(phone.page), { timeout: 15_000 }).toBe(true);
  await expect(phone.page.getByText('Waiting for another of your devices')).toHaveCount(0);
  await expect(locked(phone.page)).toHaveCount(0);
});

test('signing out takes the key off the device', async ({ page }) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect.poll(() => holdsKey(page)).toBe(true);
  // Asked outside the page, which may still be settling after signing in.
  const accountId = (
    (await (await page.request.get('/api/auth/get-session')).json()) as { user: { id: string } }
  ).user.id;
  await signOut(page);
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain(`tally-vault-${accountId}`);
});

test('the recovery key, kept when offered, unlocks a device nothing else can, however it is typed', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  // The account starts with no recovery key: a run in the other browser may have kept one, and none is offered while one is kept.
  const before = (
    (await (await page.request.get('/api/keys')).json()) as {
      wraps: { id: string; method: string }[];
    }
  ).wraps;
  const origin = new URL(page.url()).origin;
  for (const wrap of before.filter((w) => w.method === 'recovery')) {
    await page.request.delete(`/api/keys/wraps/${wrap.id}`, { headers: { origin } });
  }
  // Offered as it is right after sign-up.
  await page.evaluate(() => window.sessionStorage.setItem('tally.offer-recovery', '1'));
  await page.reload();
  const offer = page.getByRole('dialog', { name: 'Save your recovery key' });
  await expect(offer).toBeVisible();
  const code = (await offer.getByLabel('Your recovery key').textContent()) ?? '';
  expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
  await offer.getByRole('button', { name: 'I have kept it' }).click();
  await expect(offer).toHaveCount(0);
  const wraps = (
    (await (await page.request.get('/api/keys')).json()) as { wraps: { method: string }[] }
  ).wraps;
  expect(wraps.filter((w) => w.method === 'recovery')).toHaveLength(1);

  await using phone = await secondBrowser(browser);
  await phone.page.route('**/api/keys', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reply = await route.fetch();
    const body = (await reply.json()) as { wraps: { method: string }[] };
    await route.fulfill({
      response: reply,
      json: { ...body, wraps: body.wraps.filter((w) => w.method !== 'password') },
    });
  });
  await trySignIn(phone.page, EMAIL, PASSWORD);
  await expect(locked(phone.page)).toBeVisible();
  await hydrated(phone.page);
  await phone.page.getByRole('button', { name: 'Use your recovery key' }).click();
  const dialog = phone.page.getByRole('dialog', { name: 'Use your recovery key' });
  // A code that is not one is told apart from the right one.
  await dialog.getByLabel('Recovery key').fill('not a recovery key');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByText('That is not a recovery key. Check each character.')).toBeVisible();
  await dialog.getByLabel('Recovery key').fill(code.toLowerCase().replace(/-/g, ' '));
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => holdsKey(phone.page)).toBe(true);
  await expect(locked(phone.page)).toHaveCount(0);
});
