import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, signedIn, untilMembers } from './helpers';
import { seedPlaceholders } from './seed';

/**
 * A group's settings (DESIGN.md §7, §15.3): every refusal of leaving, removing and closing shows its sentence while a balance is not zero; Delete is
 * absent once an expense exists and deletes an empty group; a rename shows everywhere.
 */
test('says why leaving, removing and closing are refused, and hides Delete once an expense exists', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Rules ${Date.now()}`);
  const groupId = groupIdOf(page);
  await seedPlaceholders(groupId, ['Sam']);
  await untilMembers(page, ['Sam']);
  await addExpense(page, '20.00', 'Dinner');

  await page.getByRole('link', { name: 'Group settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await hydrated(page);
  await expect(page.getByRole('button', { name: 'Delete the group' })).toHaveCount(0);
  await expect(
    page.getByText('A group that has had an expense or a payment is closed, not deleted.'),
  ).toBeVisible();

  const settings = page.getByRole('article', { name: 'Group settings' });
  const confirmAnd = async (button: string, confirmLabel: string) => {
    await settings.getByRole('button', { name: button }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirmLabel }).click();
  };
  await confirmAnd('Close the group', 'Close');
  await expect(settings.getByRole('alert')).toHaveText(
    '2 people are not settled up. A group is closed once everyone is.',
  );
  await confirmAnd('Leave the group', 'Leave');
  await expect(settings.getByRole('alert')).toHaveText(
    'You are owed €10.00 in this group. Settle up before you leave.',
  );
  await settings
    .getByRole('region', { name: 'People' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(settings.getByRole('alert')).toHaveText(
    'Sam owes €10.00 in this group. Settle up before they are removed.',
  );

  // A rename, sealed on the device, is the name everywhere.
  const renamed = `Renamed ${Date.now()}`;
  await settings.getByRole('form', { name: 'Name' }).getByLabel('Name').fill(renamed);
  await settings.getByRole('button', { name: 'Rename' }).click();
  await expect(settings.getByText('The name is changed.')).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: new RegExp(`^${renamed}`) }),
  ).toBeVisible();
});

test('deletes a group that never had an expense', async ({ page }) => {
  await signedIn(page);
  await hydrated(page);
  const name = `Empty ${Date.now()}`;
  await newGroup(page, name);
  await page.getByRole('link', { name: 'Group settings' }).click();
  await hydrated(page);
  await page.getByRole('button', { name: 'Delete the group' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('list', { name: 'Your groups' }).getByText(name)).toHaveCount(0);
});
