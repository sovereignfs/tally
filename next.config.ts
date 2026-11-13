import type { NextConfig } from 'next';
import { SECURITY_HEADERS } from './src/security/csp';

const config: NextConfig = {
  // One self-contained server in .next/standalone: what the image runs (task 1.10).
  output: 'standalone',
  poweredByHeader: false,
  // Loaded by Node at run time, not bundled: pg is CommonJS with optional native parts, and libsql ships a native addon that only the `file:`
  // database loads.
  serverExternalPackages: ['pg', '@libsql/client', 'libsql'],
  // Next's own trailing-slash redirect is answered before the proxy and the headers below, so it would go out with no policy. The proxy makes the
  // same redirect instead, with the headers every response has (proxy.ts).
  skipTrailingSlashRedirect: true,
  // The headers every response has, pages and APIs alike (DESIGN.md §20). The page's own policy, which has a nonce, is the proxy's.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default config;
