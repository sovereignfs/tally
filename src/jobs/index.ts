import type { Config } from '../config';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has. Each task that has one adds it here: pruning the history (6.5), the mail outbox
 * (8.1) and keeping notices to 90 days (9.1).
 * Each claims its work with a conditional update (`claim.ts`), so any process may run it at any time and one does the work.
 */
export const jobs: readonly JobDefinition[] = [];

/**
 * Starts the jobs, or says why not. `TALLY_WORKER=off` runs nothing in this process: when several share a database, one runs the jobs and the
 * others only serve (DESIGN.md §5). Returns the runner, so that the server can stop it.
 */
export function startJobs(
  config: Pick<Config, 'worker'>,
  definitions: readonly JobDefinition[] = jobs,
  deps: RunnerDeps = realDeps,
): JobRunner | undefined {
  if (!config.worker) {
    deps.log('[tally] jobs: off in this process (TALLY_WORKER=off)');
    return undefined;
  }
  const runner = new JobRunner(deps);
  for (const job of definitions) runner.register(job);
  runner.start();
  deps.log(`[tally] jobs: running ${definitions.length} job${definitions.length === 1 ? '' : 's'}`);
  return runner;
}
