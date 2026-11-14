import { expect, test } from '@playwright/test';
import { addExpense, groupIdOf, hydrated, newGroup, signedIn } from './helpers';

/**
 * Activity (DESIGN.md §12.1, §15.8): what happened in a group in words from the reader's point of view, its text opened on the device, in the group's
 * Activity view and on /activity, with filters that combine.
 */
test('says what happened in words, in the group and across groups, with filters that combine', async ({
  page,
}) => {
  await signedIn(page);
  await hydrated(page);
  const name = `Seen ${Date.now()}`;
  await newGroup(page, name);
  const groupId = groupIdOf(page);
  await addExpense(page, '9.60', 'Tram tickets');
  await page
    .getByRole('region', { name: 'Expenses' })
    .getByRole('link', { name: /Tram tickets/ })
    .click();
  const comment = page.getByRole('form', { name: 'Add a comment' });
  await comment.getByLabel('Comment').fill('Thanks!');
  await comment.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByRole('region', { name: 'Comments' })).toContainText('Thanks!');

  await page.goto(`/g/${groupId}?view=activity`);
  const activity = page.getByRole('region', { name: 'Activity' });
  await expect(activity).toContainText('You paid €9.60 for Tram tickets', { timeout: 20_000 });
  await expect(activity).toContainText('You commented on Tram tickets: “Thanks!”');
  await expect(activity).toContainText(`You made the group ${name}`);

  await page.goto(`/activity?group=${groupId}`);
  const all = page.getByRole('region', { name: 'Activity' });
  await expect(all).toContainText('You paid €9.60 for Tram tickets');
  await all.getByLabel('Kind').selectOption({ label: 'Comments' });
  await expect(page).toHaveURL(
    new RegExp(`group=${groupId}.*kind=comment_added|kind=comment_added.*group=${groupId}`),
  );
  await expect(all).toContainText('You commented on Tram tickets');
  await expect(all).not.toContainText('You paid €9.60');
});
