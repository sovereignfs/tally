import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, secondBrowser, signedIn } from './helpers';

/**
 * Journeys 3 and 4 of DESIGN.md §3, with no mail set up: Ada adds Sam, who has no account, by name; Sam is in the first expense; the invitation is a
 * link (the screen says it is the only way). Sam opens it, makes an account (sign-up is by invitation here), joins, and finds the group with the expense
 * and their balance already there. The used link then reads as any invalid one.
 */
test('someone with no account is added, invited by a link, signs up and finds the group with their balance', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Lisbon ${Date.now()}`;
  await newGroup(page, groupName);
  const groupId = groupIdOf(page);
  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  const people = page.getByRole('region', { name: 'People' });
  await people.getByLabel('Add people').fill('Sam');
  await people.getByRole('button', { name: 'Add “Sam” as not on Tally yet' }).click();
  await expect(people.getByRole('listitem').filter({ hasText: 'Sam' })).toContainText(
    'not on Tally yet',
  );
  await page.goto(`/g/${groupId}`);
  await addExpense(page, '30.00', 'Dinner at Ramiro');

  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  await page
    .getByRole('region', { name: 'People' })
    .getByRole('button', { name: 'Invite Sam' })
    .click();
  const invitation = page.getByRole('status', { name: 'Invitation for Sam' });
  await expect(invitation).toContainText('Mail is not set up here, so this link is the only way');
  const link = (await invitation.locator('code').textContent()) ?? '';
  // The copied link carries the group's key in its fragment (15.5): the epoch and a secret.
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}#\d+\.[A-Za-z0-9_-]{43}$/);
  const secret = link.split('.').pop() ?? '';

  await using phone = await secondBrowser(browser);
  const sam = phone.page;
  // Nothing Sam's browser sends carries the fragment's secret: not an address, not a body.
  const sent: string[] = [];
  phone.context.on('request', (request) =>
    sent.push(`${request.url()} ${request.postData() ?? ''}`),
  );
  await sam.goto(link);
  await expect(sam.getByRole('heading', { name: 'You are invited' })).toBeVisible();
  await expect(sam.getByRole('status', { name: 'The group' })).toContainText(groupName);
  await expect(sam.getByText(/added you to a group on Tally/)).toBeVisible();
  await sam.getByRole('link', { name: 'Create an account' }).click();
  await hydrated(sam);
  const email = `sam-${Date.now()}@example.com`;
  await sam.getByLabel('Name').fill('Sam');
  await sam.getByLabel('Email').fill(email);
  await sam.getByLabel('Password').fill('a long password for sam');
  await sam.getByRole('button', { name: 'Create account' }).click();
  await expect(sam.getByRole('heading', { name: 'You are invited' })).toBeVisible({
    timeout: 20_000,
  });
  await hydrated(sam);
  await sam.getByRole('button', { name: 'Join the group' }).click();
  await expect(sam).toHaveURL(new RegExp(`/g/${groupId}$`), { timeout: 20_000 });
  // Their place, with the dinner and their balance in it, and its words at once: the key came with the link.
  await expect(sam.getByText('you owe €15.00')).toBeVisible({ timeout: 20_000 });
  await expect(sam.getByRole('heading', { level: 1, name: groupName })).toBeVisible();
  await expect(
    sam.getByRole('region', { name: 'Expenses' }).getByRole('link', { name: /Dinner at Ramiro/ }),
  ).toBeVisible();
  expect(sent.some((line) => line.includes(secret))).toBe(false);
  await expect(sam.getByRole('region', { name: 'Expenses' }).getByRole('listitem')).toHaveCount(1);

  // Used, it reads as any link that cannot be used.
  await sam.goto(link);
  await expect(sam.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
  await sam.goto(`/invite/${'A'.repeat(43)}`);
  await expect(sam.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
});
