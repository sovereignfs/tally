import { serviceWorkerSource } from '@sovereignfs/pwa';
import { SYNC_MESSAGE, SYNC_TAG } from '../sync/background';

/**
 * **The service worker** (DESIGN.md §15.11), as the text served at `/sw.js`: the suite's, from `@sovereignfs/pwa`, with Tally's version, cache name,
 * built files and shell. It is a string and not a module, because a worker is its own script with no bundler between it and the browser, so that a
 * test evaluates the very text that is served.
 *
 * **What it keeps, and nothing else:** the build's own files (the allow-list, all under `/_next/static/`, the same for everyone), the icons and the manifest,
 * and **the one shell page, `/shell`**, which holds nothing of a person. Every other request, every API answer and every page with a person's data goes to
 * the network and is never stored: a person's groups live in IndexedDB, named per account and deleted at sign-out (§11.1).
 *
 * **With no network,** or none in time, every navigation is answered with the kept shell page, which reads the device's store (task 6.4) and chooses the
 * screen from the address; an address that is not a screen of the groups says it needs a connection (`OfflineShell`). A new version waits until a page
 * asks it to take over, which the registration does when the person chooses Reload.
 *
 * **Background Sync** (§11.3): the browser wakes the worker when a connection is back after a write made without one, and the worker tells the pages that
 * are open to sync, which they do through their own loop. `@sovereignfs/pwa` 0.2.0 has no way to say this, so it is added after the package's text, and
 * goes to the package's `sync` option once 0.3.0 is released (Sovereign task 20.2).
 */
export const CACHE_PREFIX = 'tally-shell-';

function backgroundSyncSource(): string {
  return `
// Background Sync (Tally, DESIGN.md §11.3): it wakes the pages that are open, which sync through their own loop; with none open the changes wait for the
// next time Tally is opened.
self.addEventListener('sync', function (event) {
  if (event.tag !== ${JSON.stringify(SYNC_TAG)}) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (pages) {
      for (var i = 0; i < pages.length; i += 1) pages[i].postMessage({ type: ${JSON.stringify(SYNC_MESSAGE)} });
    })
  );
});
`;
}

export function workerSource(version: string, files: readonly string[] = []): string {
  return (
    serviceWorkerSource({
      version,
      cachePrefix: CACHE_PREFIX,
      precache: files,
      shell: '/shell',
      // The design system's grey 900 and white, as the manifest's colours are.
      offlineColors: { light: ['#ffffff', '#18181b'], dark: ['#18181b', '#fafafa'] },
    }) + backgroundSyncSource()
  );
}

/**
 * The worker for a server that is not a production build (`next dev`): it keeps nothing, and removes itself and the caches of any other. A worker that kept
 * files there would show yesterday's code, since a development server's files do not change their names when they change.
 */
export function inertWorkerSource(): string {
  return `'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(${JSON.stringify(CACHE_PREFIX)})).map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  );
});
`;
}
