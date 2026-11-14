import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

// The account's key and its wraps (DESIGN.md §5.3).
const keys = keyHandlers();
export const dynamic = 'force-dynamic';
export const GET = accountRoute(keys.get);
export const POST = accountRoute(keys.create);
export const PUT = accountRoute(keys.replace);
