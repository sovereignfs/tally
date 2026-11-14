import { expect, test } from '@playwright/test';
import { addExpense, expectNoSideScroll, groupIdOf, hydrated, newGroup, signedIn } from './helpers';

/**
 * The phone (DESIGN.md §15.11), run by the `phone` project only (`playwright.config.ts`): the floating Add opens the add sheet as a drawer with the page's group, Insights is in the
 * avatar menu, and no screen scrolls sideways.
 */

test('the floating Add opens the sheet, Insights is in the avatar menu, and no screen scrolls sideways', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Pocket ${Date.now()}`);
  const groupId = groupIdOf(page);
  await page.getByRole('button', { name: 'Add expense' }).last().click();
  const form = page.getByRole('form', { name: 'Add expense' });
  await expect(form).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`add=expense.*g=${groupId}|g=${groupId}.*add=expense`));
  await expectNoSideScroll(page);
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await addExpense(page, '12.30', 'Pastries');
  const expenseLink = page
    .getByRole('region', { name: 'Expenses' })
    .getByRole('link', { name: /Pastries/ });
  const expenseHref = (await expenseLink.getAttribute('href')) ?? '';

  for (const path of [
    '/',
    '/groups',
    `/g/${groupId}`,
    `/g/${groupId}?view=balances`,
    `/g/${groupId}?view=activity`,
    expenseHref,
    `/g/${groupId}/settings`,
    '/people',
    '/activity',
    '/settings',
  ]) {
    await page.goto(path);
    await hydrated(page);
    await page.waitForTimeout(200);
    await expectNoSideScroll(page);
  }

  await page.getByRole('button', { name: 'User menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Insights' })).toBeVisible();
});
