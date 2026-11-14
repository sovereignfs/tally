import { expect, test, type Page } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  ensureAccount,
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

/** Whether this device's vault holds the account's key: the record is sealed under the device's key, so only its presence is read. */
async function holdsKey(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const session = (await (await fetch('/api/auth/get-session')).json()) as {
      user?: { id: string };
    } | null;
    const id = session?.user?.id;
    if (!id) return false;
    return new Promise<boolean>((resolve) => {
      const open = indexedDB.open(`tally-vault-${id}`);
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        resolve(false);
      };
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.close();
          return resolve(false);
        }
        const get = db.transaction('keys').objectStore('keys').get('secret:account-key');
        // Closed after reading, so that this test's look does not hold up a sign-out deleting the vault.
        get.onsuccess = () => {
          resolve(get.result !== undefined);
          db.close();
        };
        get.onerror = () => {
          resolve(false);
          db.close();
        };
      };
    });
  });
}

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
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Allow' }).click();

  await expect.poll(() => holdsKey(phone.page), { timeout: 15_000 }).toBe(true);
  await expect(phone.page.getByText('Waiting for another of your devices')).toHaveCount(0);
  await expect(locked(phone.page)).toHaveCount(0);
});

test('signing out takes the key off the device', async ({ page }) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect.poll(() => holdsKey(page)).toBe(true);
  const accountId = await page.evaluate(
    async () =>
      ((await (await fetch('/api/auth/get-session')).json()) as { user: { id: string } }).user.id,
  );
  await signOut(page);
  // Signing out goes to the front address, which sends a visitor on to sign in: looked at once it has arrived.
  await page.waitForURL('**/sign-in');
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain(`tally-vault-${accountId}`);
});
