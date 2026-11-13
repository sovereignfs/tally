import { expect, test, type Page } from '@playwright/test';
import { hydrated, offline, secondBrowser, signedIn } from './helpers';
import { PORTS } from './ports';

/**
 * The first browser tests: the built app is up on its database, its page is the frame it should be, and the browser enforces the policy it is
 * sent. They are small on purpose: the point is that there is a way to test what only a browser can show, and that it fails when the page is
 * broken.
 */

/** Records every Content-Security-Policy violation the page raises, from before it runs anything. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}

test('the app is up on its database, and says which', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(['sqlite', 'postgres']).toContain(body.database);
});

test('the page is the shell: a header with the wordmark, the places, and the main area', async ({
  page,
}) => {
  await signedIn(page);
  const violations = await recordViolations(page);
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/');

  await expect(page).toHaveTitle('Home · Tally');
  const header = page.getByRole('banner');
  // The wordmark, drawn lowercase and silent, since the link says the name.
  await expect(header.getByRole('link', { name: 'Tally' })).toBeVisible();
  await expect(header.getByText('tally.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  // The sidebar: Add expense first, the four places, then the groups' section with its own link.
  const sidebar = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(sidebar.getByRole('button', { name: 'Add expense' })).toBeVisible();
  await expect(sidebar.getByRole('link')).toHaveText([
    'Home',
    'People',
    'Activity',
    'Insights',
    'Groups',
  ]);
  await expect(sidebar.getByRole('button', { name: 'New group' })).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(errors.filter((text) => !/favicon|Failed to load resource/.test(text))).toEqual([]);
});

test('each place opens, and is marked as the current one', async ({ page }) => {
  await signedIn(page);
  await page.goto('/');
  const places = page.getByRole('navigation', { name: 'Main' }).first();
  for (const name of ['People', 'Activity', 'Insights', 'Groups', 'Home']) {
    await places.getByRole('link', { name: name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(places.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  }
});

test('the browser refuses an inline event handler, which the policy does not allow', async ({
  page,
}) => {
  const violations = await recordViolations(page);
  await page.goto('/sign-in');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img src="data:," onerror="window.__ran = true">',
    );
  });
  await expect.poll(violations).toContain('script-src-attr inline');
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran),
  ).toBeUndefined();
});

test('a page that is not there is a page, with a way back', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go back to Tally' })).toHaveAttribute('href', '/');
});

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the page is dark from the first paint, with no flash of light', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(9, 9, 11)');
  });
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the header and the page fit, with nothing to scroll sideways', async ({ page }) => {
    await signedIn(page);
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('the footer has the places, and the sidebar is not drawn', async ({ page }) => {
    await signedIn(page);
    await page.goto('/people');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'People' })).toHaveAttribute('href', '/people');
    await expect(footer.getByRole('link', { name: 'People' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The same addresses as the sidebar of a wide screen: the width decides what is drawn and nothing else.
    for (const [name, href] of [
      ['Home', '/'],
      ['Groups', '/groups'],
      ['Activity', '/activity'],
    ] as const) {
      await expect(footer.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await expect(page.locator('nav[aria-label="Main"]').first()).toBeHidden();
    // The sidebar's toggle goes with the sidebar.
    await expect(page.getByRole('button', { name: 'Narrow the sidebar' })).toBeHidden();
  });

  test('the middle button opens Add expense and Insights', async ({ page }) => {
    await signedIn(page);
    await page.goto('/');
    await hydrated(page);
    await page.getByRole('contentinfo').getByRole('button', { name: 'Apps' }).click();
    const drawer = page.getByRole('dialog', { name: 'More' });
    await expect(drawer.getByRole('button', { name: 'Add expense' })).toBeVisible();
    await drawer.getByRole('link', { name: 'Insights' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  });
});

test('the sidebar narrows to a rail and stays one, drawn as a rail from the first paint', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/people');
  await hydrated(page);
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'full');
  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'rail');
  const sidebar = page.getByRole('navigation', { name: 'Main' }).first();
  expect((await sidebar.boundingBox())?.width).toBeLessThan(80);
  // A rail still names each place to a screen reader.
  await expect(sidebar.getByRole('link', { name: 'Activity' })).toBeVisible();

  // The attribute is put on the page before it is drawn, from this browser's choice, and not by the button after.
  await page.addInitScript(() => {
    (window as unknown as { __first?: string | null }).__first = null;
    document.addEventListener('readystatechange', () => {
      const w = window as unknown as { __first?: string | null };
      w.__first ??= document.documentElement.getAttribute('data-sidebar');
    });
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'rail');
  expect(await page.evaluate(() => (window as unknown as { __first?: string }).__first)).toBe(
    'rail',
  );
  await expect(page.getByRole('button', { name: 'Widen the sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Widen the sidebar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'full');
});

test('the typeface is the design system’s, served from this origin', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/sign-in');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('Hanken Grotesk');
  const foreign = requested.filter(
    (url) => !url.startsWith(`http://localhost:${PORTS.app}/`) && !url.startsWith('data:'),
  );
  expect(foreign).toEqual([]);
});

test('a second browser is a second device: nothing it keeps is shared with the first', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'rail');

  await using other = await secondBrowser(browser);
  await other.page.goto('/');
  await expect(other.page.locator('html')).toHaveAttribute('data-sidebar', 'full');
});

test('offline, a request fails and the browser says it is offline; after, it is back', async ({
  page,
  context,
}) => {
  await page.goto('/sign-in');
  const reach = () =>
    page.evaluate(async () => {
      try {
        return (await fetch('/api/health', { cache: 'no-store' })).status;
      } catch {
        return 'failed';
      }
    });
  await offline(context, async () => {
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await reach()).toBe('failed');
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect(await reach()).toBe(200);
});

test('WebAssembly compiles under the policy, for Argon2id', async ({ page }) => {
  await page.goto('/sign-in');
  // The smallest module there is: the magic number and the version.
  const compiled = await page.evaluate(async () => {
    try {
      await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      return 'compiled';
    } catch (error) {
      return String(error);
    }
  });
  expect(compiled).toBe('compiled');
  // That eval stays refused is the policy's unit test (src/security/csp.test.ts): Playwright's own evaluation is not held to the page's policy.
});
