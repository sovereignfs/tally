import { accountRoute } from '@/src/access/route';
import { activityHandler } from '@/src/activity/api';

// The activity of the account's groups (DESIGN.md §12.1, §15.8).
export const dynamic = 'force-dynamic';
export const GET = accountRoute(activityHandler());
