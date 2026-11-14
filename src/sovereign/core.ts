import { createSovereign } from '@sovereignfs/sdk';
import type { SovereignSettings } from '../auth/config';
import type { CoreSender } from '../mail/outbox';

/**
 * **Core, as the app itself** (DESIGN.md §14.5): `@sovereignfs/sdk`'s `sv.app`, which asks core for a token for the app and holds no person's token
 * and no session, so it is made from the settings alone. What the outbox sends through it: a notification to core's bell, an email by `sub`, a line
 * on the person's activity page. Undefined where core is not set up, or the app's address is not known (a notification links back to it). As Tusk's
 * `src/notifications/server.ts` makes it.
 */
export function coreSender(
  appUrl: string | undefined,
  core: SovereignSettings | undefined,
  fetchImpl?: typeof fetch,
): CoreSender | undefined {
  if (!core || !appUrl) return undefined;
  return createSovereign({
    appUrl,
    // Core's address, from its issuer (an address under it).
    coreUrl: new URL(core.issuer).origin,
    clientId: core.clientId,
    clientSecret: core.clientSecret,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  }).app;
}
