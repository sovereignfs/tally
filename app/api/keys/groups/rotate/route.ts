import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

// A new epoch of a group's key, after someone left (DESIGN.md §5.3).
export const POST = accountRoute(keyHandlers().rotateGroup);
