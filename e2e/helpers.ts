import type { Browser, BrowserContext, Page } from '@playwright/test';

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
