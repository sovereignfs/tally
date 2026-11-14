import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

// Granting a group's key to its members (DESIGN.md §5.3).
const keys = keyHandlers();
export const dynamic = 'force-dynamic';
export const GET = accountRoute(keys.groupGrants);
export const POST = accountRoute(keys.putGroupGrants);
