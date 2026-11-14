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

/** Merging (DESIGN.md §7.2): one person in a group twice becomes once, and what they owe is the two added together. */
test('an owner merges one person in the group twice into one, whose balance is the two added together', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Twice ${Date.now()}`);
  const groupId = groupIdOf(page);
  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  const people = page.getByRole('region', { name: 'People' });
  for (const name of ['Sam', 'Samantha']) {
    await people.getByLabel('Add people').fill(name);
    await people.getByRole('button', { name: `Add “${name}” as not on Tally yet` }).click();
    await expect(page.getByText(`${name} is added, not on Tally yet.`)).toBeVisible();
  }

  await page.goto(`/g/${groupId}`);
  await addExpense(page, '30.00', 'Dinner');
  await page.getByRole('tab', { name: 'Balances' }).click();
  const owes = page.getByRole('list', { name: 'Who owes whom' }).getByRole('listitem');
  await expect(owes).toHaveCount(2);

  await page.goto(`/g/${groupId}/settings`);
  await hydrated(page);
  await people
    .getByRole('listitem')
    .filter({ hasText: 'Samantha' })
    .getByRole('button', { name: 'Merge', exact: true })
    .click();
  await people.getByLabel('Merge Samantha into').selectOption({ label: 'Sam' });
  await people.getByRole('button', { name: 'Merge into them' }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge Samantha into Sam?' });
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('Samantha is merged into Sam.')).toBeVisible();
  await expect(people.getByRole('listitem').filter({ hasText: 'Samantha' })).toHaveCount(0);

  await page.goto(`/g/${groupId}`);
  await page.getByRole('tab', { name: 'Balances' }).click();
  await expect(owes).toHaveText([/Sam owes you €20\.00/]);
});
