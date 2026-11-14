import { accountRoute } from '@/src/access/route';
import { noticesHandler } from '@/src/notices/api';

// What the signed-in account is told, and its reading of it (DESIGN.md §12.2).
export const dynamic = 'force-dynamic';
const handler = noticesHandler();
export const GET = accountRoute(handler.GET);
export const POST = accountRoute(handler.POST);
