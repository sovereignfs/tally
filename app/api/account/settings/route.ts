import { accountRoute } from '@/src/access/route';
import { readCapped } from '@/src/access/body';
import { setPrimaryCurrency } from '@/src/account/settings';
import { getDatabase } from '@/src/db/boot';

// An account's own settings (DESIGN.md §16): its primary currency.
export const PATCH = accountRoute(async ({ request, accountId }) => {
  const text = await readCapped(request, 1024);
  try {
    const input = JSON.parse(text ?? '') as { primaryCurrency?: unknown };
    const primaryCurrency = await setPrimaryCurrency(
      await getDatabase(),
      accountId,
      input.primaryCurrency,
    );
    return Response.json({ primaryCurrency });
  } catch {
    return Response.json({ code: 'invalid' }, { status: 400 });
  }
});
