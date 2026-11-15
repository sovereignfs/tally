import { expect, test } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  addExpense,
  groupIdOf,
  holdsKey,
  hydrated,
  newGroup,
  secondBrowser,
  signedIn,
  trySignIn,
  untilMembers,
  untilOpened,
} from './helpers';
import { seedPlaceholders } from './seed';

/**
 * Payments and settling up (DESIGN.md §9, §15.9): settling a suggested payment zeroes that pair, on this device and another at its next sync; a payment
 * recorded by hand for part of it reduces it by its amount.
 */
test('settling a suggested payment zeroes the pair on both devices, and a part reduces it', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Settle ${Date.now()}`);
  const groupId = groupIdOf(page);
  await seedPlaceholders(groupId, ['Sam']);
  await untilMembers(page, ['Sam']);
  await addExpense(page, '20.00', 'Groceries');
  await page.goto(`/g/${groupId}?view=balances`);
  const pairs = page.getByRole('list', { name: 'Who owes whom' });
  await expect(pairs.getByRole('listitem')).toHaveText([/Sam owes you €10\.00/]);

  await pairs.getByRole('link', { name: /Settle up: Sam owes you/ }).click();
  const form = page.getByRole('form', { name: 'Record a payment' });
  await expect(form.getByRole('status', { name: 'What will be recorded' })).toHaveText(
    'Record that Sam paid you €10.00?',
  );
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Nobody owes anybody.')).toBeVisible();

  await using laptop = await secondBrowser(browser);
  await trySignIn(laptop.page, EMAIL, PASSWORD);
  await expect.poll(() => holdsKey(laptop.page)).toBe(true);
  await laptop.page.goto(`/g/${groupId}?view=balances`);
  await expect(laptop.page.getByText('Nobody owes anybody.')).toBeVisible({ timeout: 20_000 });

  // Another 20.00 for the two of you: Sam owes 10.00 again; Sam pays 4.00 of it, recorded by hand with P.
  await page.goto(`/g/${groupId}`);
  await addExpense(page, '20.00', 'Wine');
  await hydrated(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('p');
  const byHand = page.getByRole('form', { name: 'Record a payment' });
  await untilOpened(byHand);
  await byHand.getByLabel('Who paid').selectOption({ label: 'Sam' });
  await byHand.getByLabel('Who was paid').selectOption({ label: 'you' });
  await byHand.getByLabel('Amount', { exact: true }).fill('4');
  await byHand.getByRole('button', { name: 'Record payment' }).click();
  await expect(byHand).toHaveCount(0);
  await page.goto(`/g/${groupId}?view=balances`);
  await expect(page.getByRole('list', { name: 'Who owes whom' }).getByRole('listitem')).toHaveText([
    /Sam owes you €6\.00/,
  ]);
  // The payments are rows of the group's list.
  await page.goto(`/g/${groupId}`);
  await expect(
    page
      .getByRole('region', { name: 'Expenses' })
      .getByRole('link', { name: /Sam paid you €4\.00/ }),
  ).toBeVisible();
});
