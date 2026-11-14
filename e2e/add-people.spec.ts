import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, signedIn } from './helpers';

/**
 * Adding people (DESIGN.md §6.2): a name typed in a group's settings is added as "not on Tally yet", and is in the next expense's split at once.
 */
test('adds a placeholder by name, who can be in an expense from that moment', async ({ page }) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Friends ${Date.now()}`);
  const groupId = groupIdOf(page);
  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  const people = page.getByRole('region', { name: 'People' });
  await people.getByLabel('Add people').fill('Sam');
  await people.getByRole('button', { name: 'Add “Sam” as not on Tally yet' }).click();
  await expect(page.getByText('Sam is added, not on Tally yet.')).toBeVisible();
  await expect(people.getByRole('listitem').filter({ hasText: 'Sam' })).toContainText(
    'not on Tally yet',
  );

  await page.goto(`/g/${groupId}`);
  await addExpense(page, '30.00', 'Dinner');
  await page.getByRole('tab', { name: 'Balances' }).click();
  await expect(page.getByRole('list', { name: 'Who owes whom' }).getByRole('listitem')).toHaveText([
    /Sam owes you €15\.00/,
  ]);
});
