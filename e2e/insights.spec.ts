import { expect, test } from '@playwright/test';
import {
  addExpense,
  groupIdOf,
  hydrated,
  newGroup,
  offline,
  signedIn,
  untilMembers,
} from './helpers';
import { seedPlaceholders } from './seed';

/**
 * Insights (DESIGN.md §13): dinner for four, paid by the reader, is a quarter of it spent by them; `/insights` and the group's view show the figures in
 * a chart and in a table a screen reader reads; the group's view is drawn from the device, with no network.
 */
test('dinner for four is a quarter of it spent, in the reader’s Insights and the group’s, offline too', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await hydrated(page);
  const groupName = `Feast ${Date.now()}`;
  await newGroup(page, groupName);
  const groupId = groupIdOf(page);
  await seedPlaceholders(groupId, ['Ben', 'Cy', 'Dee']);
  await untilMembers(page, ['Ben', 'Cy', 'Dee']);
  await addExpense(page, '100.00', 'Dinner for four', 'Eating out');

  // The group's view: the group spent €100.00 on eating out, a quarter each; from the device, with the network off.
  await offline(context, async () => {
    await page.getByRole('tab', { name: 'Insights' }).click();
    await expect(page).toHaveURL(/view=insights/);
    const byCategory = page.getByRole('table', {
      name: /^What the group spent by category, in EUR$/,
    });
    await expect(byCategory.getByRole('row', { name: /Eating out\s+€100\.00/ })).toBeVisible();
    const shares = page.getByRole('table', {
      name: /^Each member’s share of what the group spent, in EUR$/,
    });
    for (const name of ['You', 'Ben', 'Cy', 'Dee'])
      await expect(
        shares.getByRole('row', { name: new RegExp(`^${name}\\s+€25\\.00$`) }),
      ).toBeVisible();
    await expect(shares.getByRole('row', { name: /^Total\s+€100\.00$/ })).toBeVisible();
  });

  // The reader's own: the group is €25.00 of what they spent; this month's eating out has it in.
  await page.goto('/insights');
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  const byGroup = page.getByRole('table', { name: /^What you spent in each group, in EUR$/ });
  await expect(
    byGroup.getByRole('row', { name: new RegExp(`^${groupName}\\s+€25\\.00$`) }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('table', { name: /^What you spent by category in .+, in EUR$/ })
      .getByRole('row', {
        name: /^Eating out\s+€/,
      }),
  ).toBeVisible();
  const months = page.getByRole('table', {
    name: /^What you spent each month, the twelve to .+, in EUR$/,
  });
  await expect(months.getByRole('row')).toHaveCount(14);
});
