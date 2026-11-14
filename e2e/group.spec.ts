import { expect, test } from '@playwright/test';
import { addExpense, hydrated, newGroup, signedIn } from './helpers';

/**
 * A group's page (DESIGN.md §15.5): its header and its expenses by month, with the reader's part in words; search and filters in the address; a thousand
 * expenses painted from the device with no spinner; a group the reader is not in, not found.
 */
test('shows the group, its expenses by month with your part, and search and filters in the address', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  const name = `Porto ${Date.now()}`;
  await newGroup(page, name);
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await addExpense(page, '84.00', 'Dinner', 'Eating out');
  await addExpense(page, '12.00', 'Taxi', 'Transport');
  const list = page.getByRole('region', { name: 'Expenses' });
  await expect(list.getByRole('link', { name: /Dinner/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /Taxi/ })).toContainText('You paid €12.00');
  await expect(list.getByRole('link', { name: /Taxi/ })).toContainText('you paid your share');

  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('/');
  await expect(list.getByLabel('Search expenses')).toBeFocused();
  await page.keyboard.type('tax');
  await expect(page).toHaveURL(/q=tax/);
  await expect(list.getByRole('link', { name: /Dinner/ })).toHaveCount(0);
  await expect(list.getByRole('link', { name: /Taxi/ })).toBeVisible();
  await list.getByLabel('Search expenses').fill('');
  await list.getByLabel('Category').selectOption({ label: 'Eating out' });
  await expect(page).toHaveURL(/category=eating_out/);
  await expect(list.getByRole('link', { name: /Taxi/ })).toHaveCount(0);
  // The address alone brings the same list back.
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Expenses' }).getByRole('link', { name: /Dinner/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Expenses' }).getByRole('link', { name: /Taxi/ }),
  ).toHaveCount(0);
});

test('paints a thousand expenses from the device, with no spinner', async ({ page }) => {
  await signedIn(page);
  await hydrated(page);
  await newGroup(page, `Big ${Date.now()}`);
  const groupId = /\/g\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  // A thousand rows in the device's store, as if pulled: the screen reads only the store.
  await page.evaluate(async (id) => {
    const me = JSON.parse(localStorage.getItem('tally.me') ?? '{}') as { id?: string };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(`tally-${me.id}`);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const member = await new Promise<{ id: string }>((resolve) => {
      const get = db.transaction('member').objectStore('member').index('byGroup').get(id);
      get.onsuccess = () => resolve(get.result as { id: string });
    });
    const tx = db.transaction('expense', 'readwrite');
    for (let i = 0; i < 1000; i++)
      tx.objectStore('expense').put({
        id: `bulk-${id}-${i}`,
        groupId: id,
        sealed: `s1.1.${'A'.repeat(80)}`,
        amount: 100 + i,
        currency: 'EUR',
        date: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`,
        category: 'general',
        method: 'equal',
        payers: [{ memberId: member.id, amount: 100 + i }],
        shares: [{ memberId: member.id, amount: 100 + i, units: null }],
        version: 1,
        createdBy: 'x',
        updatedBy: 'x',
        deletedAt: null,
        createdAt: i,
        updatedAt: i,
        seq: 1,
      });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, groupId);
  const started = Date.now();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Expenses' }).getByRole('listitem')).toHaveCount(
    1000,
    { timeout: 10_000 },
  );
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('a group that is not here reads as not found', async ({ page }) => {
  await signedIn(page);
  await page.goto(`/g/${crypto.randomUUID()}`);
  await expect(page.getByText('This group is not here')).toBeVisible();
});
