import { accountRoute } from '@/src/access/route';
import { acceptHandler } from '@/src/invites/api';

// Accepting an invitation (DESIGN.md §6.3).
export const POST = accountRoute(acceptHandler());
