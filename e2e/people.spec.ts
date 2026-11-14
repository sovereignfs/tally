import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, signedIn, untilMembers } from './helpers';
import { seedMembers, seedPlaceholders } from './seed';

/**
 * Home, People and a person (DESIGN.md §15.4, §15.7), with the same placeholder seeded into two groups: the figures across both groups and two
 * currencies, never blended; settling up with the person records one payment in each and zeroes both.
 */
test('shows where you stand across two groups and two currencies, and settles up with a person in each', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  const sam = `Sam ${Date.now()}`;

  // Lisbon, in euros: you pay €30.00 for you and Sam. Sam owes you €15.00.
  await newGroup(page, `Lisbon ${Date.now()}`);
  const lisbon = groupIdOf(page);
  const [samPerson] = await seedPlaceholders(lisbon, [sam]);
  await untilMembers(page, [sam]);
  await addExpense(page, '30.00', 'Dinner');

  // Tokyo: Sam pays ¥1000 for the two of you. You owe Sam ¥500.
  await newGroup(page, `Tokyo ${Date.now()}`);
  const tokyo = groupIdOf(page);
  await seedMembers(tokyo, [{ name: sam, personId: samPerson ?? '' }]);
  await untilMembers(page, [sam]);
  await addExpense(page, '1000', 'Ramen', undefined, async (form) => {
    await form.getByRole('button', { name: 'Currency' }).click();
    await page.getByPlaceholder('Search currencies').fill('JPY');
    await page.getByRole('option', { name: /^JPY/ }).click();
    // What was typed stays as typed in the new currency.
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('1000');
    await form.getByLabel('Paid by').selectOption({ label: sam });
  });

  await page.goto('/');
  // Your balance sums every group of the account, which other tests share; what lies with Sam is this test's alone.
  const standing = page.getByRole('region', { name: 'Your balance' });
  await expect(standing).toContainText('You are owed €');
  await expect(standing).toContainText('You owe ¥');
  const toSettle = page.getByRole('region', { name: 'To settle' });
  await expect(toSettle.getByRole('listitem').filter({ hasText: sam })).toContainText(
    `${sam} owes you €15.00`,
  );
  await expect(toSettle.getByRole('listitem').filter({ hasText: sam })).toContainText(
    `you owe ${sam} ¥500`,
  );

  await page.goto('/people');
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('link', { name: new RegExp(sam) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: sam })).toBeVisible();
  await expect(page.getByText('not on Tally yet')).toBeVisible();
  await expect(page.getByRole('region', { name: 'By group' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: `Settle up with ${sam}` }).click();
  const confirm = page.getByRole('dialog', { name: `Settle up with ${sam}?` });
  await expect(confirm).toContainText('This records 2 payments');
  await confirm.getByRole('button', { name: 'Record the payments' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('article', { name: sam }).getByText('settled up')).toBeVisible();
  for (const groupId of [lisbon, tokyo]) {
    await page.goto(`/g/${groupId}?view=balances`);
    await expect(page.getByText('Nobody owes anybody.')).toBeVisible();
  }
});
