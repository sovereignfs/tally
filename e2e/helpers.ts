import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * What the browser tests share. The sync tests (epic 6) need two people's browsers at once and a browser with no network; these are the ways to
 * have them, so that each test does not invent its own.
 */

/**
 * Waits until React has taken over the page. A form filled or a button pressed before that is lost when it does, and on a slow runner (WebKit on
 * a shared one) that is between two actions. React marks each element it has taken over, and the first control of the page is one. From Ledger's
 * helpers, where WebKit on CI showed the need.
 */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const control = document.querySelector('main input, main button, header button, nav a');
    return control !== null && Object.keys(control).some((key) => key.startsWith('__reactProps$'));
  });
}

/**
 * A second browser, as a second person or a second device has: its own cookies, its own storage and its own IndexedDB, nothing shared with the
 * test's own `page`. Closed by `close`, which a test calls in a `finally` or leaves to `using`.
 */
export async function secondBrowser(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const close = () => context.close();
  return { context, page, close, [Symbol.asyncDispose]: close };
}

/**
 * Runs `work` with the browser offline, as on a plane, and brings it back online after, whether `work` succeeded or not. Every page of the context is
 * offline: requests fail, and `navigator.onLine` is false.
 */
export async function offline<T>(context: BrowserContext, work: () => Promise<T>): Promise<T> {
  await context.setOffline(true);
  try {
    return await work();
  } finally {
    await context.setOffline(false);
  }
}

/**
 * What the browser tests that need a signed-in person share. The instance is closed to sign-up, so the first account is the only one there will be,
 * and it is made by whichever test gets here first: both browsers share the instance, so every test starts by making sure there is one. From
 * Ledger's helpers.
 */
export const EMAIL = 'owner@example.com';
export const PASSWORD = 'correct horse battery';

export async function ensureAccount(page: Page) {
  await page.goto('/sign-up');
  const create = page.getByRole('heading', { name: 'Create your account' });
  if (!(await create.isVisible())) return;
  await hydrated(page);
  await page.getByLabel('Name').fill('Ada');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // A new account is offered its recovery key once (DESIGN.md §5.3): skipped here, as a person may.
  const offer = page.getByRole('dialog', { name: 'Save your recovery key' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);
  await signOut(page);
}

/**
 * Opens the sign-in page. Right after the page has signed itself out it is already on its way to `/sign-in`, and WebKit then refuses a second
 * navigation to the same address ("interrupted by another navigation"). That one is not a failure: the page is going where we asked, so let it
 * arrive, and only ask again if it did not.
 */
async function gotoSignIn(page: Page) {
  try {
    await page.goto('/sign-in');
  } catch (error) {
    // WebKit says "interrupted by another navigation", Chromium `net::ERR_ABORTED`: the same thing, a page already on its way somewhere.
    if (!/interrupted by another navigation|ERR_ABORTED/.test(String(error))) throw error;
    await page.waitForLoadState('load');
    if (new URL(page.url()).pathname !== '/sign-in') await page.goto('/sign-in');
  }
}

/**
 * Fills the sign-in form and submits it. Sign-in is rate-limited per address (three attempts in ten seconds), and both browsers reach this instance
 * from the same one, so an attempt can be told to wait: it then does, once the window has passed, as a person would.
 */
export async function trySignIn(page: Page, email: string, password: string) {
  await gotoSignIn(page);
  await hydrated(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const submit = page.getByRole('button', { name: 'Sign in' });
  await submit.click();
  const limited = page.getByText(/Too many tries/);
  const outcome = page
    .getByText(/do not match/)
    .or(page.getByRole('button', { name: 'User menu' }));
  await expect(limited.or(outcome)).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_500);
    await submit.click();
  }
}

/** Makes sure there is an account, and signs it in. */
export async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  // Signing out goes to the front address, the landing page for a visitor: the next step waits until it has arrived, or its own navigation would be
  // interrupted by this one.
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.waitForLoadState('load');
}

/** Whether this device's vault holds the account's key: the record is sealed under the device's key, so only its presence is read. */
export async function holdsKey(page: Page): Promise<boolean> {
  // A page still on its way somewhere (just after signing in) cannot answer yet: "not yet", so that a poll asks again.
  return holdsKeyNow(page).catch(() => false);
}

async function holdsKeyNow(page: Page): Promise<boolean> {
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
