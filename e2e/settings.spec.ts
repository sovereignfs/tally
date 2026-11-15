import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  addExpense,
  holdsKey,
  hydrated,
  newGroup,
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

test('Notifications says mail is not set up here, so the bell is the only way, and links to each group’s choice', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Told ${Date.now()}`;
  await newGroup(page, groupName);
  await openSettings(page, 'notifications');
  const section = page.getByRole('region', { name: 'Notifications' });
  await expect(section).toContainText(
    'Mail is not set up on this server, so the bell is the only way you are told.',
  );
  // Nothing to turn on: every email switch is there, and none can be used.
  const switches = section.getByRole('list', { name: 'Email me when' }).getByRole('switch');
  await expect(switches).toHaveCount(10);
  await expect(
    section.getByRole('switch', { name: 'Email: Someone adds you to a group' }),
  ).toBeDisabled();
  await section.getByRole('link', { name: groupName }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}\/settings$/);
});

test('Data downloads one plain file of the profile and every group, with no one else’s address, and imports it back as a new group', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Taken ${Date.now()}`;
  await newGroup(page, groupName);
  const groupId = /\/g\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await addExpense(page, '42.00', 'Ferry to Cacilhas');

  await openSettings(page, 'data');
  const section = page.getByRole('region', { name: 'Data' });
  await expect(section).toContainText('The file is plain text');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: 'Download your data' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^tally-export-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile((await download.path()) ?? '', 'utf8');
  const file = JSON.parse(text) as {
    format: string;
    version: number;
    profile: { email: string };
    groups: {
      id: string;
      name: string | null;
      expenses: { description: string | null; amount: number }[];
    }[];
  };
  expect(file).toMatchObject({ format: 'tally', version: 1, profile: { email: EMAIL } });
  const group = file.groups.find((g) => g.id === groupId);
  expect(group?.name).toBe(groupName);
  expect(group?.expenses).toEqual([
    expect.objectContaining({ description: 'Ferry to Cacilhas', amount: 4200 }),
  ]);
  // The person's own address and nobody else's.
  expect(new Set(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g))).toEqual(
    new Set([EMAIL]),
  );
  await expect(section.getByRole('status').first()).toHaveText('Downloaded.');

  // Import it back, just this group: a copy, owned by the importer, its words opened on this device at once.
  const one = {
    ...JSON.parse(text),
    groups: [JSON.parse(text).groups.find((g: { id: string }) => g.id === groupId)],
  };
  await section.getByLabel('A Tally export to import').setInputFiles({
    name: 'tally-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(one)),
  });
  await expect(
    section.getByText('Imported 1 group. You will find it with your groups.'),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.goto('/groups');
  const copies = page.getByRole('main').getByRole('link', { name: new RegExp(groupName) });
  await expect(copies).toHaveCount(2);
  const copy = (await copies.evaluateAll((links) => links.map((l) => l.getAttribute('href')))).find(
    (href) => href && !href.includes(groupId),
  );
  await page.goto(copy ?? '/');
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Expenses' }).getByRole('link', { name: /Ferry to Cacilhas/ }),
  ).toBeVisible();

  // A file from a newer Tally is refused, with a sentence.
  await openSettings(page, 'data');
  await section.getByLabel('A Tally export to import').setInputFiles({
    name: 'newer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...one, version: 9 })),
  });
  await expect(section.getByText(/made by a newer Tally/)).toBeVisible();
});
