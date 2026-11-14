import { type Page, expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, secondBrowser, signedIn } from './helpers';

/**
 * Notices and the bell (DESIGN.md §12.2): Sam joins Ada's group by a link; Ada records an expense; Sam's bell shows one unread, in words opened on the
 * device, and opening it goes to the expense and reads it. Ada, who acted, is told nothing of it. `/notifications` lists it by day.
 */
async function joinAs(page: Page, link: string, name: string) {
  await page.goto(link);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await hydrated(page);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(`${name.toLowerCase()}-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill(`a long password for ${name}`);
  // Several accounts made within seconds meet sign-up's rate limit ("Too many tries"): wait, and try again, as a person would.
  await expect(async () => {
    if (await page.getByRole('button', { name: 'Create account' }).isVisible())
      await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'You are invited' })).toBeVisible({
      timeout: 8_000,
    });
  }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
  await hydrated(page);
  await page.getByRole('button', { name: 'Join the group' }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  // A new account is offered its recovery key once (DESIGN.md §5.3); it can be skipped.
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 20_000 });
}

test('a member is told in the bell of an expense another recorded, and the one who recorded it is not', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Porto ${Date.now()}`;
  await newGroup(page, groupName);
  const groupId = groupIdOf(page);
  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  const people = page.getByRole('region', { name: 'People' });
  await people.getByLabel('Add people').fill('Sam');
  await people.getByRole('button', { name: 'Add “Sam” as not on Tally yet' }).click();
  await people.getByRole('button', { name: 'Invite Sam' }).click();
  const link =
    (await page
      .getByRole('status', { name: 'Invitation for Sam' })
      .locator('code')
      .textContent()) ?? '';

  await using phone = await secondBrowser(browser);
  const sam = phone.page;
  await joinAs(sam, link, 'Sam');
  await expect(sam.getByRole('heading', { level: 1, name: groupName })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(`/g/${groupId}`);
  await addExpense(page, '12.00', 'Taxi to the river');

  // Sam's bell: one unread, said in words with the description opened on the device.
  const bell = sam.getByRole('button', { name: /^Notifications/ });
  await expect
    .poll(
      async () => {
        await sam.reload();
        return bell.getAttribute('aria-label');
      },
      { timeout: 30_000 },
    )
    .toBe('Notifications (1 unread)');
  await bell.click();
  const told = sam.getByRole('link', {
    name: new RegExp(`paid €12\\.00 for Taxi to the river in ${groupName}`),
  });
  await expect(told).toBeVisible();
  await told.click();
  await expect(sam).toHaveURL(new RegExp(`/g/${groupId}/e/[0-9a-f-]{36}`));
  await expect(bell).toHaveAttribute('aria-label', 'Notifications');

  // On the whole list, by day, and read.
  await sam.goto('/notifications');
  const today = sam.getByRole('list', { name: 'Notifications, Today' });
  await expect(today.getByRole('listitem')).toHaveCount(1);
  await expect(today.getByRole('link', { name: /Taxi to the river/ })).not.toHaveAccessibleName(
    /unread/,
  );

  // Ada, who recorded it, was told only that Sam took her invitation, and nothing of the expense.
  await page.goto('/notifications');
  const adas = page
    .getByRole('list', { name: 'Notifications, Today' })
    .getByRole('listitem')
    .filter({ hasText: groupName });
  await expect(adas).toHaveCount(1);
  await expect(adas).toContainText('Sam took your invitation and joined');
});

/** Reminders (DESIGN.md §12.4): Remind beside someone who owes you, once a day, said in their bell; someone not on Tally cannot be reminded with no mail. */
test('reminds someone who owes you, once a day, and their bell says how much', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Faro ${Date.now()}`;
  await newGroup(page, groupName);
  const groupId = groupIdOf(page);
  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  const people = page.getByRole('region', { name: 'People' });
  for (const name of ['Sam', 'Kim']) {
    await people.getByLabel('Add people').fill(name);
    await people.getByRole('button', { name: `Add “${name}” as not on Tally yet` }).click();
    await expect(page.getByText(`${name} is added, not on Tally yet.`)).toBeVisible();
  }
  await people.getByRole('button', { name: 'Invite Sam' }).click();
  const link =
    (await page
      .getByRole('status', { name: 'Invitation for Sam' })
      .locator('code')
      .textContent()) ?? '';
  await using phone = await secondBrowser(browser);
  const sam = phone.page;
  await joinAs(sam, link, 'Sam');

  await page.goto(`/g/${groupId}`);
  await addExpense(page, '30.00', 'Boat trip');
  await page.getByRole('tab', { name: 'Balances' }).click();
  const owes = page.getByRole('region', { name: 'Balances' });
  await owes.getByRole('button', { name: 'Remind Sam' }).click();
  await expect(owes.getByRole('status')).toHaveText('Sam is reminded.');
  await expect(
    owes.getByRole('button', { name: /^Reminded Sam: again in \d+ (hours?|minutes?)$/ }),
  ).toBeDisabled();

  // Kim is not on Tally and mail is not set up here: the server says so.
  await owes.getByRole('button', { name: 'Remind Kim' }).click();
  await expect(owes.getByRole('status').filter({ hasText: 'Kim' })).toHaveText(
    'Mail is not set up here, so Kim cannot be reminded. Send them their invitation link instead.',
  );

  // Sam's bell.
  const bell = sam.getByRole('button', { name: /^Notifications/ });
  await expect
    .poll(
      async () => {
        await sam.reload();
        return bell.getAttribute('aria-label');
      },
      { timeout: 30_000 },
    )
    .toMatch(/unread/);
  await bell.click();
  await expect(
    sam.getByRole('link', { name: `Ada reminded you that you owe €10.00 in ${groupName}` }),
  ).toBeVisible();

  // After a reload, Remind still waits until tomorrow.
  await page.reload();
  await hydrated(page);
  await page.getByRole('tab', { name: 'Balances' }).click();
  await expect(owes.getByRole('button', { name: /^Reminded Sam/ })).toBeDisabled();
});
