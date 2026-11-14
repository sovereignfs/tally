import { expect, test } from '@playwright/test';
import {
  EMAIL,
  PASSWORD,
  hydrated,
  holdsKey,
  newGroup,
  offline,
  secondBrowser,
  signedIn,
  trySignIn,
} from './helpers';

/**
 * The shell's places and the groups list (DESIGN.md §15.2, §15.3): a group made from the sidebar is there at once, in the sidebar and on `/groups`, and
 * on a second device at its next sync; making one offline says it needs a connection.
 */

test('a new group is in the sidebar and on /groups at once, and on another device at its next sync', async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await hydrated(page);
  const name = `Lisbon ${Date.now()}`;
  await newGroup(page, name);
  // The sidebar is a wide screen's.
  if (test.info().project.name !== 'phone') {
    const sidebar = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('region', { name: 'Groups' });
    await expect(sidebar.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.goto('/groups');
  await expect(page.getByRole('list', { name: 'Your groups' }).getByText(name)).toBeVisible();

  await using laptop = await secondBrowser(browser);
  await trySignIn(laptop.page, EMAIL, PASSWORD);
  await expect.poll(() => holdsKey(laptop.page)).toBe(true);
  await laptop.page.goto('/groups');
  await expect(laptop.page.getByRole('list', { name: 'Your groups' }).getByText(name)).toBeVisible({
    timeout: 20_000,
  });
});

test('making a group offline says it needs a connection, and makes nothing', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await hydrated(page);
  await expect.poll(() => holdsKey(page)).toBe(true);
  const name = `Offline ${Date.now()}`;
  await page.goto('/groups');
  await hydrated(page);
  await offline(context, async () => {
    await page.getByRole('main').getByRole('button', { name: 'New group' }).click();
    const form = page.getByRole('form', { name: 'New group' });
    await form.getByLabel('Name').fill(name);
    await form.getByRole('button', { name: 'Make the group' }).click();
    await expect(form.getByText('Making a group needs a connection.')).toBeVisible();
  });
  await page.goto('/groups');
  await expect(page.getByText(name)).toHaveCount(0);
});
