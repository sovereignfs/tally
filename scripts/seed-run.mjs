// A realistic set of groups to develop against: `pnpm seed`, or `pnpm seed -- --reset` to start it again. The work is in `scripts/seed.ts`; this
// only runs it, through `jiti`, which reads TypeScript, so that it uses the app's own code and not a copy of it. As Tusk's.
//
// It reads `.env.local`, which `pnpm dev` writes, as Next does, so that it seeds the database the development server uses; a value in your own shell
// wins over it.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const local = resolve(import.meta.dirname, '..', '.env.local');
if (existsSync(local)) process.loadEnvFile(local);

const jiti = createJiti(import.meta.url);
const { main } = await jiti.import('./seed.ts');
process.exit(await main(process.argv.slice(2)));
