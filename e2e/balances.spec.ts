import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, signedIn, untilMembers } from './helpers';
import { seedPlaceholders } from './seed';

/**
 * A group's balances (DESIGN.md §15.5, §10), with two placeholders seeded as members: each member's balance and who owes whom match a hand-worked case,
 * and turning simplify debts on changes the pairs.
 */
test('shows each balance and who owes whom, pairwise and then simplified', async ({ page }) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Shared ${Date.now()}`);
  const groupId = groupIdOf(page);
  await seedPlaceholders(groupId, ['Sam', 'Lee']);
  await untilMembers(page, ['Sam', 'Lee']);

  // You pay 20.00 for you and Sam; Sam pays 20.00 for Sam and Lee. Pairwise: Sam owes you 10.00, Lee owes Sam 10.00. Simplified: Lee owes you 10.00.
  await addExpense(page, '20.00', 'Lunch', undefined, async (form) => {
    await form.getByRole('checkbox', { name: 'Lee' }).uncheck();
  });
  await addExpense(page, '20.00', 'Taxi', undefined, async (form) => {
    await form.getByLabel('Paid by').selectOption({ label: 'Sam' });
    // The sheet remembers the last split (you and Sam): this one is Sam and Lee.
    await form.getByRole('checkbox', { name: 'Lee' }).check();
    await form.getByRole('checkbox', { name: 'You' }).uncheck();
  });
  await page.getByRole('tab', { name: 'Balances' }).click();
  await expect(page).toHaveURL(/view=balances/);
  const balances = page.getByRole('list', { name: 'Each member’s balance' });
  await expect(balances.getByRole('listitem').filter({ hasText: 'You' })).toContainText(
    'you are owed €10.00',
  );
  await expect(balances.getByRole('listitem').filter({ hasText: 'Sam' })).toContainText(
    'settled up',
  );
  await expect(balances.getByRole('listitem').filter({ hasText: 'Lee' })).toContainText(
    'owes €10.00',
  );
  const pairs = page.getByRole('list', { name: 'Who owes whom' });
  await expect(pairs.getByRole('listitem')).toHaveText([
    /Sam owes you €10\.00/,
    /Lee owes Sam €10\.00/,
  ]);
  await expect(pairs.getByRole('link', { name: /Settle up: Sam owes you/ })).toBeVisible();

  const turned = await page.request.post('/api/ops', {
    data: { op: 'group.simplify', groupId, on: true },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(turned.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Who owes whom' }).getByRole('listitem')).toHaveText(
    [/Lee owes you €10\.00/],
    { timeout: 20_000 },
  );
  await expect(page.getByText(/Debts are simplified/)).toBeVisible();
});
