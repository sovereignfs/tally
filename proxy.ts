import { type NextRequest, NextResponse } from 'next/server';
import { hasSessionCookie } from './src/auth/cookie';
import { edgeSettings } from './src/config/edge';
import { HSTS, SECURITY_HEADERS, contentSecurityPolicy, newNonce } from './src/security/csp';

/**
 * **Every page is sent with a Content-Security-Policy** with a nonce of its own (`src/security/csp.ts`), so every page is rendered per request, the
 * landing page too. The proxy makes the nonce and puts the policy on the request, where Next reads it and puts the nonce on the scripts and styles
 * it makes, and the layout puts it on the theme script (`x-nonce`); it puts the policy on the response too, where the browser enforces it. An API's
 * answer is data, with no page to protect, so it gets only the headers every response has (`next.config.ts`).
 *
 * It keeps the Edge discipline: no Node built-ins and no database. It only looks at the request, so a session is for the page to check, and a
 * proxy is never the only thing standing in the way (DESIGN.md §5.2).
 *
 * **The front address, `/`, is the landing page for a visitor and Home for someone with a session cookie** (DESIGN.md §15.3), as Ledger's: the proxy
 * rewrites the request to `/home` and the address stays `/`. Only the cookie's presence is looked at: it cannot be checked here, and the page checks the
 * session itself and sends a forged cookie to sign in. The page's own address, `/home`, goes to `/`, so that there is one address for it.
 */
const SIGN_IN_PAGES = new Set(['/sign-in', '/sign-up', '/forgot-password', '/reset-password']);

/** Set on the request the proxy rewrites `/` into, so that the page it is rewritten to is not sent back to `/` (which would be a loop). */
const HOME_MARK = 'x-tally-home';

export function proxy(request: NextRequest) {
  const { secure, development, authLocal } = edgeSettings();
  const page = !request.nextUrl.pathname.startsWith('/api/');
  const nonce = newNonce();
  const policy = contentSecurityPolicy({ nonce, secure, development });

  // `/people/` is `/people`, as Next would answer it, but from here, so that the redirect carries the headers too (next.config.ts turns Next's off).
  // A redirect made here carries every header a response has (Next's own would carry none).
  const redirectTo = (pathname: string) => {
    // A plain URL: NextURL formats the path by the app's trailing-slash rule, and would put the slash back.
    const target = new URL(request.url);
    target.pathname = pathname;
    const redirect = NextResponse.redirect(target, 308);
    for (const { key, value } of SECURITY_HEADERS) redirect.headers.set(key, value);
    if (page) redirect.headers.set('content-security-policy', policy);
    if (secure) redirect.headers.set('strict-transport-security', HSTS);
    return redirect;
  };
  const slashless = withoutTrailingSlash(request.nextUrl.pathname);
  if (slashless !== request.nextUrl.pathname) return redirectTo(slashless);
  const path = request.nextUrl.pathname;
  const cookie = hasSessionCookie(request.cookies);
  if (cookie && path === '/home' && !request.headers.has(HOME_MARK)) return redirectTo('/');

  const requestHeaders = new Headers(request.headers);
  // Set, never trusted: a nonce or a policy the client sent is replaced here, and an API's request carries neither.
  if (page) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', policy);
  } else {
    requestHeaders.delete('x-nonce');
    requestHeaders.delete('content-security-policy');
  }

  // Off means off (DESIGN.md §14.1): with local sign-in off, the sign-in pages are not there. A page cannot say so itself: the root loading state has
  // already sent a 200 by the time it would, so the proxy answers with the page that is not found, and its status.
  const absent = !authLocal && SIGN_IN_PAGES.has(path);
  const signedIn = path === '/' && cookie;
  const target = absent ? '/not-found' : signedIn ? '/home' : null;
  if (signedIn && !absent) requestHeaders.set(HOME_MARK, '1');
  else requestHeaders.delete(HOME_MARK);
  const response = target
    ? NextResponse.rewrite(new URL(target, request.url), { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  if (page) response.headers.set('content-security-policy', policy);
  if (secure) response.headers.set('strict-transport-security', HSTS);
  return response;
}

/** A path without its trailing slashes, `/` itself aside. */
export function withoutTrailingSlash(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Everything but the build's own static files, which are not pages and are the same for everyone (and cannot carry a nonce), and prefetches. */
export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|sw.js|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
