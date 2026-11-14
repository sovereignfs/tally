import { accountRoute } from '@/src/access/route';
import { historyHandler } from '@/src/history/api';

// An expense's or a payment's history (DESIGN.md §8.5).
export const dynamic = 'force-dynamic';
export const GET = accountRoute(historyHandler());
