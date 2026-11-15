import { accountRoute } from '@/src/access/route';
import { readCapped } from '@/src/access/body';
import { getDatabase } from '@/src/db/boot';
import { OpError } from '@/src/groups/errors';
import { importGroups } from '@/src/portability/import';
import { noteOnCore } from '@/src/sovereign/activity';

// Importing a file as new groups (DESIGN.md §17): what the browser checked and sealed, checked again and written in one transaction, or not at all.
export const dynamic = 'force-dynamic';
const MAX_BODY = 32 * 1024 * 1024;

export const POST = accountRoute(async ({ request, accountId, personId }) => {
  const text = await readCapped(request, MAX_BODY);
  if (text === null)
    return Response.json(
      { code: 'too_large', message: 'That file is too large to import.' },
      { status: 413 },
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(
      { code: 'invalid', message: 'That file could not be imported. Nothing was imported.' },
      { status: 400 },
    );
  }
  const database = await getDatabase();
  try {
    const made = await importGroups(database, { accountId, personId }, body);
    await noteOnCore(database, personId, 'You imported groups into Tally from a file.');
    return Response.json(made, { status: 201 });
  } catch (error) {
    if (error instanceof OpError)
      return Response.json(
        { code: error.code, message: error.message },
        {
          status:
            error.code === 'rate_limited'
              ? 429
              : error.code === 'too_many_groups' || error.code === 'id_taken'
                ? 409
                : 400,
        },
      );
    throw error;
  }
});
