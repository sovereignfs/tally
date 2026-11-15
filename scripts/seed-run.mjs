// A realistic set of groups to develop against: `pnpm seed`, or `pnpm seed -- --reset` to start it again. The work is in `scripts/seed.ts`; this
// only runs it, through `jiti`, which reads TypeScript, so that it uses the app's own code and not a copy of it. As Tusk's.
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { main } = await jiti.import('./seed.ts');
process.exit(await main(process.argv.slice(2)));
