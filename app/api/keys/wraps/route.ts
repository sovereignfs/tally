import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

const keys = keyHandlers();
export const POST = accountRoute(keys.putWrap);
