import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  holdsKey,
  hydrated,
  secondBrowser,
  signOut,
  signedIn,
  trySignIn,
} from './helpers';

/**
 * Settings (DESIGN.md §16): the name kept on the person, a password change that keeps unlocking a new device, a passkey that unlocks one by itself, the
 * recovery key from Unlocking, and deleting the account asking for the password.
 */
const NEW_PASSWORD = 'a different long password';

async function openSettings(page: Page, section?: string) {
  await page.goto(section ? `/settings?section=${section}` : '/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await hydrated(page);
}

async function changePassword(page: Page, from: string, to: string) {
  await openSettings(page, 'security');
  const form = page.getByRole('form', { name: 'Change password' });
  await form.getByLabel('Current password').fill(from);
  await form.getByLabel(/^New password(?! again)/).fill(to);
  await form.getByLabel('New password again').fill(to);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your password is changed')).toBeVisible();
}

test('is in the avatar menu, and the name changed there is the one shown everywhere', async ({
  page,
}) => {
  await signedIn(page);
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  for (const name of ['Profile', 'Security', 'Unlocking', 'Preferences', 'This device', 'Data']) {
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name }),
    ).toBeVisible();
  }
  await hydrated(page);
  const form = page.getByRole('form', { name: 'Display name' });
  await form.getByLabel('Name').fill('Ada Lovelace');
  await form.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Your name is saved.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'User menu' }).click();
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await page.keyboard.press('Escape');
  // Back, for the other tests.
  await hydrated(page);
  await page.getByRole('form', { name: 'Display name' }).getByLabel('Name').fill('Ada');
  await page
    .getByRole('form', { name: 'Display name' })
    .getByRole('button', { name: 'Save name' })
    .click();
  await expect(page.getByText('Your name is saved.')).toBeVisible();
});

test('a new password unlocks a new device as the old one did', async ({ page, browser }) => {
  await signedIn(page);
  await expect.poll(() => holdsKey(page)).toBe(true);
  await changePassword(page, PASSWORD, NEW_PASSWORD);
  try {
    await using phone = await secondBrowser(browser);
    await trySignIn(phone.page, EMAIL, NEW_PASSWORD);
    await expect(phone.page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await expect.poll(() => holdsKey(phone.page)).toBe(true);
    await expect(phone.page.getByRole('region', { name: 'This device is locked' })).toHaveCount(0);
  } finally {
    // Back, for the other tests: from this device, which holds the key, so the old password's wrap is made again.
    await changePassword(page, NEW_PASSWORD, PASSWORD);
  }
});

test('Unlocking says what opens a new device, and keeps a recovery key from there', async ({
  page,
}) => {
  await signedIn(page);
  await expect.poll(() => holdsKey(page)).toBe(true);
  await openSettings(page, 'unlocking');
  const list = page.getByRole('list', { name: 'What unlocks a new device' });
  await expect(list).toContainText('Your password.');
  await page.getByRole('button', { name: /recovery key/ }).click();
  const offer = page.getByRole('dialog', { name: 'Save your recovery key' });
  await expect(offer.getByLabel('Your recovery key')).toHaveText(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
  await offer.getByRole('button', { name: 'I have kept it' }).click();
  await expect(page.getByText('You have kept a recovery key.')).toBeVisible();
});

test('This device says when it last synced, and that nothing is waiting', async ({ page }) => {
  await signedIn(page);
  await openSettings(page, 'device');
  const section = page.getByRole('region', { name: 'This device' });
  await expect(
    section.getByText(/Last synced .*Everything recorded here has been sent\./),
  ).toBeVisible();
  await expect(section.getByText('Nothing here')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Some changes couldn’t sync' })).toHaveCount(0);
});

test('deleting the account asks for the password, and a wrong one deletes nothing', async ({
  page,
}) => {
  await signedIn(page);
  await openSettings(page, 'data');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  const form = page.getByRole('form', { name: 'Delete account' });
  await expect(form).toContainText('Your name stays on');
  await form.getByLabel('Your password').fill('not my password at all');
  await form.getByRole('button', { name: 'Delete my account for good' }).click();
  await expect(form.getByText('That is not your password.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
});

test.describe('a passkey', () => {
  // Chromium's virtual authenticator, which can be given PRF; WebKit has none to drive.
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'a virtual authenticator is Chromium’s',
  );

  async function authenticator(context: BrowserContext, page: Page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    });
    return { cdp, authenticatorId };
  }

  test('added in Settings, signs in on a device that holds nothing and unlocks it in the same touch', async ({
    page,
    context,
  }) => {
    await signedIn(page);
    await expect.poll(() => holdsKey(page)).toBe(true);
    await authenticator(context, page);
    await openSettings(page, 'security');
    await page.getByLabel('Name for the new passkey').fill('Test key');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(
      page.getByText('It signs you in, and unlocks your groups on a new device.'),
    ).toBeVisible();

    // Signing out takes the key off this device, so that it holds nothing, as a new one does; the passkey's own touch must then unlock it. (A
    // credential copied to a second virtual authenticator does not carry its PRF secret, so the same authenticator stands in for a synced passkey.)
    await signOut(page);
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).some((d) => d.name?.startsWith('tally-vault-')),
      ),
    ).toBe(false);
    await page.goto('/sign-in');
    await hydrated(page);
    await page.getByRole('button', { name: 'Use a passkey instead' }).click();
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await expect.poll(() => holdsKey(page)).toBe(true);
    await expect(page.getByRole('region', { name: 'This device is locked' })).toHaveCount(0);

    // Removed again, for the tests that come after: removing it also removes its wrap, so it unlocks nothing.
    await openSettings(page, 'security');
    await page.getByRole('button', { name: 'Remove Test key' }).click();
    await expect(
      page.getByRole('list', { name: 'Your passkeys' }).getByText('Test key'),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get('/api/keys')).json()) as { wraps: { method: string }[] }
          ).wraps.filter((w) => w.method === 'passkey').length,
      )
      .toBe(0);
  });
});
