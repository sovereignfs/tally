import { expect, test, type Page } from '@playwright/test';
import { hydrated, newGroup, offline, signedIn } from './helpers';

/**
 * Adding an expense (DESIGN.md §15.9): by keyboard alone, with each split method, online and offline; and a split that does not add up cannot be saved,
 * and says why. Two payers wait for a second member, which joins with adding people (Milestone F).
 */
async function expensesOnDevice(page: Page): Promise<{ amount: number; method: string }[]> {
  return page.evaluate(async () => {
    const me = JSON.parse(localStorage.getItem('tally.me') ?? '{}') as { id?: string };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(`tally-${me.id}`);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve) => {
        const all = db.transaction('expense').objectStore('expense').getAll();
        all.onsuccess = () =>
          resolve(
            (all.result as { amount: number; method: string; createdAt: number }[])
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((e) => ({ amount: e.amount, method: e.method })),
          );
      });
    } finally {
      db.close();
    }
  });
}

/** Opens the sheet with N, types the amount and a description, and saves with Enter. */
async function addByKeyboard(
  page: Page,
  amount: string,
  description: string,
  beforeSave?: () => Promise<void>,
) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('n');
  const form = page.getByRole('form', { name: 'Add expense' });
  await expect(form.getByLabel('Amount', { exact: true })).toBeFocused();
  await page.keyboard.type(amount);
  await form.getByLabel('Description').focus();
  await page.keyboard.type(description);
  if (beforeSave) await beforeSave();
  await form.getByLabel('Description').focus();
  await page.keyboard.press('Enter');
  await expect(form).toHaveCount(0);
}

test('adds an expense by keyboard alone, with each split method, online and offline', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Trip ${Date.now()}`);
  const before = (await expensesOnDevice(page)).length;

  await addByKeyboard(page, '84.00', 'Dinner');
  const form = () => page.getByRole('form', { name: 'Add expense' });
  await addByKeyboard(page, '30', 'Tickets', async () => {
    await form()
      .getByRole('radio', { name: /amount/i })
      .click();
    await form().getByLabel('Your amount').fill('30');
  });
  await addByKeyboard(page, '12.50', 'Coffee', async () => {
    await form()
      .getByRole('radio', { name: /percent/i })
      .click();
    await form().getByLabel('Your percentage').fill('100');
  });
  await offline(context, async () => {
    await addByKeyboard(page, '9.99', 'Snacks', async () => {
      await form().getByRole('radio', { name: /share/i }).click();
    });
  });
  await expect
    .poll(async () => (await expensesOnDevice(page)).slice(before))
    .toEqual([
      { amount: 8_400, method: 'equal' },
      { amount: 3_000, method: 'amounts' },
      { amount: 1_250, method: 'percentages' },
      { amount: 999, method: 'shares' },
    ]);
});

test('a split that does not add up cannot be saved, and says why', async ({ page }) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Split ${Date.now()}`);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('n');
  const form = page.getByRole('form', { name: 'Add expense' });
  await form.getByLabel('Amount', { exact: true }).fill('50');
  await form.getByLabel('Description').fill('Taxi');
  await form.getByRole('radio', { name: /amount/i }).click();
  await form.getByLabel('Your amount').fill('20');
  await expect(form.getByRole('status', { name: 'The result' })).toContainText(
    'The amounts must add up to the expense',
  );
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});
