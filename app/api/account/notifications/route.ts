import { accountRoute } from '@/src/access/route';
import { readCapped } from '@/src/access/body';
import { getDatabase } from '@/src/db/boot';
import { setPref } from '@/src/notices/prefs';

// What the account is told by each channel, kind by kind (DESIGN.md §12.3): its own choices, by its session.
export const PATCH = accountRoute(async ({ request, accountId }) => {
  const text = await readCapped(request, 1024);
  try {
    const input = JSON.parse(text ?? '') as {
      kind?: unknown;
      channel?: unknown;
      enabled?: unknown;
    };
    await setPref(await getDatabase(), accountId, input.kind, input.channel, input.enabled);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ code: 'invalid' }, { status: 400 });
  }
});
