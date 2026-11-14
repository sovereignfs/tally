import { accountRoute } from '@/src/access/route';
import { opsHandler } from '@/src/groups/api';

// The online operations of groups (DESIGN.md §7, §11.6).
export const POST = accountRoute(opsHandler());
