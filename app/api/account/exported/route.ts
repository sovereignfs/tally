import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { noteOnCore } from '@/src/sovereign/activity';

// An export was downloaded (DESIGN.md §17): noted on the person's activity page in core when Tally is hosted (§14.5). Nothing else is kept of it.
export const POST = accountRoute(async ({ accountId, personId }) => {
  const database = await getDatabase();
  // A few an hour: each is a line on core's page, and nothing else.
  const taken = await new RateLimiter(database).take(`exported:${accountId}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (taken.ok) await noteOnCore(database, personId, 'You downloaded your data from Tally.');
  return new Response(null, { status: 204 });
});
