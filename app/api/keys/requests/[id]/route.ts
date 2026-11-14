import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

const keys = keyHandlers();
export const dynamic = 'force-dynamic';
export const GET = accountRoute(keys.getRequest);
export const POST = accountRoute(keys.approveRequest);
export const DELETE = accountRoute(keys.deleteRequest);
