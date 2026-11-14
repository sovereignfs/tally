import { accountRoute } from '@/src/access/route';
import { keyHandlers } from '@/src/keys/api';

// A new device asking for the account's key (DESIGN.md §5.3).
const keys = keyHandlers();
export const POST = accountRoute(keys.createRequest);
