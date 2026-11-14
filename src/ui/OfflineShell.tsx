'use client';

/**
 * The kept shell, offline (DESIGN.md §15.11). Until it reads the device's store (task 6.4), it says what it is: the app is installed, and this address
 * needs the groups to have been opened here once.
 */
export function OfflineShell() {
  return (
    <main style={{ padding: 'var(--sv-space-6)', maxWidth: '32rem', margin: '0 auto' }}>
      <h1>Tally</h1>
      <p>You are offline. Your groups open here once this device has been online with them.</p>
    </main>
  );
}
