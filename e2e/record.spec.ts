import { expect, test, type Page } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  addExpense,
  holdsKey,
  hydrated,
  newGroup,
  offline,
  secondBrowser,
  signedIn,
  trySignIn,
} from './helpers';

/**
 * An expense's page (DESIGN.md §15.6): two devices edit it from the same version, the later stands and the earlier is kept as replaced, and Restore this
 * version makes it current again; a comment added offline on one device appears on the other after sync.
 */
async function edit(page: Page, amount: string) {
  await page.getByRole('link', { name: 'Edit' }).click();
  const form = page.getByRole('form', { name: 'Edit expense' });
  await form.getByLabel('Amount', { exact: true }).fill(amount);
  await form.getByLabel('Description').press('Enter');
  await expect(form).toHaveCount(0);
}

const amountShown = (page: Page) =>
  page.getByRole('article', { name: 'Expense' }).getByRole('paragraph').first();

test('a replaced version is restored from history, and an offline comment reaches the other device', async ({
  page,
  browser,
  context: _,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `History ${Date.now()}`);
  await addExpense(page, '80.00', 'Dinner');
  await page
    .getByRole('region', { name: 'Expenses' })
    .getByRole('link', { name: /Dinner/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
  const expenseUrl = page.url();

  await using laptop = await secondBrowser(browser);
  await trySignIn(laptop.page, EMAIL, PASSWORD);
  await expect.poll(() => holdsKey(laptop.page)).toBe(true);
  await laptop.page.goto(expenseUrl);
  await expect(laptop.page.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible({
    timeout: 20_000,
  });
  await hydrated(laptop.page);

  // The laptop edits offline from version 1, and comments; meanwhile this device edits from version 1 online and its edit reaches the server first.
  await offline(laptop.context, async () => {
    await edit(laptop.page, '90.00');
    const comment = laptop.page.getByRole('form', { name: 'Add a comment' });
    await comment.getByLabel('Comment').fill('On me next time');
    await comment.getByRole('button', { name: 'Comment' }).click();
    await expect(laptop.page.getByRole('region', { name: 'Comments' })).toContainText(
      'On me next time',
    );
    await edit(page, '84.00');
    await expect(amountShown(page)).toHaveText('€84.00');
    await expect(page.getByRole('region', { name: 'History' })).toContainText(
      'You changed the amount from €80.00 to €84.00',
      { timeout: 20_000 },
    );
  });

  // Now online again, the laptop's edit, made from the older version, reaches the server after this one's: it stands, and this one is replaced.
  await laptop.page.reload();
  await expect(amountShown(laptop.page)).toHaveText('€90.00', { timeout: 20_000 });
  await page.reload();
  await expect(amountShown(page)).toHaveText('€90.00', { timeout: 20_000 });
  const history = page.getByRole('region', { name: 'History' });
  await expect(history).toContainText('Your version was replaced by a later change');
  await history.getByRole('button', { name: 'Restore this version' }).click();
  await expect(amountShown(page)).toHaveText('€84.00');
  await expect(history).toContainText('You changed the amount from €90.00 to €84.00', {
    timeout: 20_000,
  });

  // The comment made offline is here too.
  await expect(page.getByRole('region', { name: 'Comments' })).toContainText('On me next time');
});
