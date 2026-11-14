import { type Page, expect, test } from '@playwright/test';
import { holdsKey, signOut } from './helpers';
import { PORTS } from './ports';

/**
 * Signing in through a core (DESIGN.md §14.1, §14.2), a fake one (`e2e/fake-sovereign-server.ts`), on two instances of their own: one that takes only
 * Sovereign with sign-up by invitation, which a core sign-in is not held to (§6.4), and one that takes both ways. From Tusk's `e2e/sovereign.spec.ts`,
 * with Tally's differences: anyone the core signs in gets in, and an account that came through core has its key made on its first device.
 * The instances keep their accounts between the two browsers, so each test is the same whichever runs first.
 */
const SOVEREIGN = `http://localhost:${PORTS.sovereign}`;
const BOTH = `http://localhost:${PORTS.both}`;

async function nextPersonIs(page: Page, who: { sub: string; email: string; name?: string }) {
  const reply = await page.request.post(`http://localhost:${PORTS.coreControl}/sign-in-as`, {
    data: who,
  });
  expect(reply.ok()).toBe(true);
}

/** Starts the sign-in at Sovereign. Sign-in is rate-limited from one address, which both browsers share: when told so, wait it out and go again. */
async function throughSovereign(page: Page) {
  const button = page.getByRole('button', { name: 'Sign in with Sovereign' });
  const limited = page.getByText(/Too many tries/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await button.click();
    await expect(
      limited
        .or(page.getByRole('button', { name: 'User menu' }))
        .or(page.getByText(/already an account/)),
    ).toBeVisible({ timeout: 20_000 });
    if (!(await limited.isVisible())) return;
    await page.waitForTimeout(10_500);
  }
}

async function signUpLocal(page: Page, name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.com`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 20_000 });
  // A new account is offered its recovery key once; skipped here.
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 20_000 });
  return { email, name };
}

test.describe('an instance that signs in through Sovereign only', () => {
  test.use({ baseURL: SOVEREIGN, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('offers Sovereign and nothing of the local ways, which are not there to find', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    for (const path of ['/sign-up', '/forgot-password', '/reset-password'])
      expect((await page.goto(path))?.status(), path).toBe(404);
  });

  test('anyone the core signs in gets in as who it says, with sign-up by invitation, and their key is made on this device', async ({
    page,
    browser,
  }) => {
    const run = Date.now();
    const people = [
      { sub: `e2e-first-${run}`, email: `first-${run}@sovereign.test`, name: 'Grace Hopper' },
      { sub: `e2e-second-${run}`, email: `second-${run}@sovereign.test`, name: 'Alan Turing' },
    ];
    for (const who of people) {
      await nextPersonIs(page, who);
      await page.goto('/sign-in');
      await throughSovereign(page);
      await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
      await page.getByRole('button', { name: 'User menu' }).click();
      await expect(page.getByText(who.name)).toBeVisible();
      await page.keyboard.press('Escape');
      // No password to unlock with: the account's key is made here, unseen, so what is written is sealed from the first group on.
      await expect.poll(() => holdsKey(page), { timeout: 20_000 }).toBe(true);
      await expect(page.getByRole('region', { name: 'This device is locked' })).toHaveCount(0);
      await signOut(page);
    }

    // Another browser of the first person's: core holds no secret for Tally, so this new device is locked until another device, the recovery key
    // or a fresh start unlocks it (DESIGN.md §5.3), and says so in one line; nothing is refused meanwhile.
    const other = await browser.newContext({ baseURL: SOVEREIGN });
    try {
      const second = await other.newPage();
      await nextPersonIs(second, people[0] ?? { sub: '', email: '' });
      await second.goto('/sign-in');
      await throughSovereign(second);
      await expect(second.getByRole('region', { name: 'This device is locked' })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await other.close();
    }
  });

  // Core's notices (DESIGN.md §14.3), signed by the fake core's control port as core signs them.
  async function noticeFrom(
    page: Page,
    kind: 'logout' | 'account-deleted',
    sub: string,
    wrong?: 'signature' | 'audience' | 'expired' | 'type',
  ): Promise<string> {
    const reply = await page.request.post(`http://localhost:${PORTS.coreControl}/notice`, {
      data: { kind, sub, sid: 'core-session-1', wrong },
    });
    expect(reply.ok()).toBe(true);
    return reply.text();
  }
  const sendLogout = (page: Page, token: string) =>
    page.request.post('/api/sovereign/backchannel-logout', { form: { logout_token: token } });
  const sendDeletion = (page: Page, token: string) =>
    page.request.post('/api/sovereign/account-deleted', { form: { account_deleted_token: token } });
  async function signInAs(page: Page, who: { sub: string; email: string; name: string }) {
    await nextPersonIs(page, who);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  }

  test('signing out at core signs the person out here, wherever they are signed in; a wrong or replayed notice ends nothing', async ({
    page,
    browser,
  }) => {
    const who = {
      sub: `e2e-out-${Date.now()}`,
      email: `out-${Date.now()}@sovereign.test`,
      name: 'Ada Lovelace',
    };
    await signInAs(page, who);
    for (const wrong of ['signature', 'audience', 'expired', 'type'] as const) {
      const reply = await sendLogout(page, await noticeFrom(page, 'logout', who.sub, wrong));
      expect(reply.status(), wrong).toBe(400);
    }
    expect((await sendDeletion(page, await noticeFrom(page, 'logout', who.sub))).status()).toBe(
      400,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

    const other = await browser.newContext({ baseURL: SOVEREIGN });
    try {
      const elsewhere = await other.newPage();
      await signInAs(elsewhere, who);
      const token = await noticeFrom(page, 'logout', who.sub);
      expect((await sendLogout(page, token)).status()).toBe(200);
      expect((await sendLogout(page, token)).status()).toBe(400);
      for (const tab of [page, elsewhere]) {
        await tab.goto('/groups');
        await expect(tab).toHaveURL(/\/sign-in/);
      }
    } finally {
      await other.close();
    }
  });

  test('a person who deletes their account at core is deleted here, and a retry is answered too', async ({
    page,
  }) => {
    const who = {
      sub: `e2e-gone-${Date.now()}`,
      email: `gone-${Date.now()}@sovereign.test`,
      name: 'Hedy Lamarr',
    };
    await signInAs(page, who);
    expect(
      (await sendDeletion(page, await noticeFrom(page, 'account-deleted', who.sub))).status(),
    ).toBe(200);
    await page.goto('/groups');
    await expect(page).toHaveURL(/\/sign-in/);
    expect(
      (await sendDeletion(page, await noticeFrom(page, 'account-deleted', who.sub))).status(),
    ).toBe(200);
    for (const path of ['/api/sovereign/backchannel-logout', '/api/sovereign/account-deleted'])
      expect((await page.request.get(path)).status(), path).toBe(405);
  });

  test('a person who declines at Sovereign is told so and is not signed in', async ({ page }) => {
    await page.goto('/sign-in?error=access_denied');
    await expect(page.getByText(/You declined to share/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });
});

test.describe('an instance that offers both ways', () => {
  test.use({ baseURL: BOTH, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('a Sovereign login with a local account’s address is refused, with what to do instead', async ({
    page,
  }) => {
    const { email } = await signUpLocal(page, 'Local Grace');
    await signOut(page);
    await nextPersonIs(page, { sub: `e2e-taken-${Date.now()}`, email, name: 'Someone Else' });
    await page.goto('/sign-in');
    await expect(page.getByLabel('Password')).toBeVisible();
    await throughSovereign(page);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/already an account here/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });

  test('a local account links Sovereign from Settings, then signs in with it as the same account', async ({
    page,
  }) => {
    const { email, name } = await signUpLocal(page, 'Local Margaret');
    await nextPersonIs(page, {
      sub: `e2e-link-${Date.now()}`,
      email,
      name: 'Someone At Sovereign',
    });
    await page.goto('/settings?section=security');
    await page.getByRole('button', { name: 'Link Sovereign' }).click();
    await expect(page).toHaveURL(/\/settings\?section=security&linked=1/);
    await expect(page.getByText('Sovereign is linked.')).toBeVisible();

    await page.goto('/');
    await signOut(page);
    await page.goto('/sign-in');
    await throughSovereign(page);
    // The account is the local one: its name, not the name Sovereign has for the person.
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await signOut(page);
  });
});

test('an instance with no core has no notice addresses', async ({ page }) => {
  for (const path of ['/api/sovereign/backchannel-logout', '/api/sovereign/account-deleted'])
    expect((await page.request.post(path, { form: { logout_token: 'x' } })).status(), path).toBe(
      404,
    );
});
