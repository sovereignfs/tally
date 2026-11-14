import { expect, test } from '@playwright/test';
import { signedIn } from './helpers';

/**
 * The PWA (DESIGN.md §15.11): a manifest a browser installs from, a worker that controls the app, and caches that hold the shell and the build's files
 * and nothing of a person after a signed-in visit.
 */
test('is installable: a manifest with a name, standalone, and icons including a maskable one', async ({
  request,
}) => {
  const reply = await request.get('/manifest.webmanifest');
  expect(reply.ok()).toBe(true);
  const manifest = (await reply.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Tally', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const icon of manifest.icons)
    expect((await request.get(icon.src)).headers()['content-type']).toBe('image/png');
});

test('registers a worker that keeps the shell and the build, and nothing of a person', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'the cache is read through Chromium here');
  await signedIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Wait for the install to have kept the shell.
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await caches.keys()).some((name) => name.startsWith('tally-shell-')),
      ),
    )
    .toBe(true);
  await page.goto('/settings');
  await page.goto('/groups');
  const kept = await page.evaluate(async () => {
    const out: { path: string; body: string }[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) {
        const response = await (await caches.open(name)).match(request);
        const type = response?.headers.get('content-type') ?? '';
        out.push({
          path: new URL(request.url).pathname,
          body: type.includes('html') ? ((await response?.text()) ?? '') : '',
        });
      }
    return out;
  });
  for (const entry of kept)
    expect(entry.path).toMatch(/^\/(shell|_next\/static\/|icons\/|manifest\.webmanifest)/);
  expect(kept.map((e) => e.path)).toContain('/shell');
  for (const entry of kept) expect(entry.body).not.toMatch(/@example\.com/);
});

test('opens a signed-in address with no network, from the device, after one visit', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'offline navigation through the worker is driven in Chromium here',
  );
  await signedIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await caches.keys()).some((name) => name.startsWith('tally-shell-')),
      ),
    )
    .toBe(true);
  // A group, made as the browser makes one (its name sealed under a key this test does not keep, so the device shows it as not yet unlocked).
  const groupId = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    const reply = await fetch('/api/ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'group.create',
        groupId: id,
        sealed: `s1.1.${'A'.repeat(80)}`,
        color: '#2563eb',
        defaultCurrency: 'EUR',
        keyWrap: `h1.${'K'.repeat(60)}`,
      }),
    });
    if (reply.status !== 201) throw new Error(`group: ${reply.status}`);
    return id;
  });
  try {
    // The device's sync pulls it into the store.
    await page.goto('/groups');
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const me = JSON.parse(localStorage.getItem('tally.me') ?? '{}') as { id?: string };
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open(`tally-${me.id}`);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          try {
            return await new Promise<boolean>((resolve) => {
              const get = db.transaction('grp').objectStore('grp').get(id);
              get.onsuccess = () => resolve(Boolean(get.result));
              get.onerror = () => resolve(false);
            });
          } finally {
            db.close();
          }
        }, groupId),
      )
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.goto('/groups');
      await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Groups on this device' }).getByRole('listitem'),
      ).not.toHaveCount(0);
      await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
      // An address the device cannot answer says it needs a connection.
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'This needs a connection' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  } finally {
    await page.request.post('/api/ops', {
      data: { op: 'group.delete', groupId },
      headers: { origin: new URL(page.url()).origin },
    });
  }
});
