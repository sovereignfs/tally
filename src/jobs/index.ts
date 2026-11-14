import type { Config } from '../config';
import { getConfig } from '../config/current';
import { getAuthDatabase, getDatabase } from '../db/boot';
import { mailJob } from '../mail/outbox';
import { smtpMailer } from '../mail/smtp';
import { site } from '../site';
import { pruneJob } from '../sync/prune';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has. Each task that has one adds it here: pruning the history (6.5), the mail outbox
 * (8.1) and keeping notices to 90 days (9.1).
 * Each claims its work with a conditional update (`claim.ts`), so any process may run it at any time and one does the work.
 */
export const jobs: readonly JobDefinition[] = [
  pruneJob(getDatabase),
  // Mail only when there is SMTP: with none the job has nothing to do, and nothing is ever written to the outbox.
  mailJob(async () => {
    const mail = getConfig().mail;
    if (!mail) return undefined;
    return {
      database: await getDatabase(),
      authDatabase: await getAuthDatabase(),
      mailer: smtpMailer(mail),
      app: site.name,
      log: (line) => console.info(line),
    };
  }),
];

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
