import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { noteOnCore } from '@/src/sovereign/activity';

// An export was downloaded (DESIGN.md §17): noted on the person's activity page in core when Tally is hosted (§14.5). Nothing else is kept of it.
export const POST = accountRoute(async ({ personId }) => {
  await noteOnCore(await getDatabase(), personId, 'You downloaded your data from Tally.');
  return new Response(null, { status: 204 });
});
