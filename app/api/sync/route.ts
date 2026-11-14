import { accountRoute } from '@/src/access/route';
import { syncHandler } from '@/src/sync/endpoint';

// The sync of expenses, payments and comments (DESIGN.md §11.3).
export const dynamic = 'force-dynamic';
export const POST = accountRoute(syncHandler());
