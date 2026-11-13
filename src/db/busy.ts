import type { Client, Transaction } from '@libsql/client';

/**
 * **A file's connections are replaced when one has waited out the busy timeout.** libSQL's file client (0.18), once a statement fails with
 * `SQLITE_BUSY` after waiting for another process's write lock, leaves that connection unable to write: the next write on it is answered as done
 * and never saved, with no error, and neither `inTransaction` nor a `ROLLBACK` shows anything open (`busy.test.ts` makes it happen). An expense
 * answered as saved and then lost is the one failure this app must not have, so a busy failure from any call, or from any statement of a
 * transaction, makes the client open new connections (`reconnect`) before the error goes on to the caller, who sees the error and can try again.
 *
 * `reconnect` closes every connection, so anything else in flight on this client at that moment fails with an error too, never silently: the app's
 * own statements on a file take turns (`exec.ts`), so there is none for them, and better-auth's are short. It needs two processes sharing one file
 * and a lock held past the timeout; one container with one process never meets it.
 */
export function isBusy(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_BUSY')) return true;
  }
  return false;
}

export function guardBusy(client: Client): Client {
  const recovering = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (isBusy(error)) await client.reconnect();
      throw error;
    }
  };

  const guardTransaction = (tx: Transaction): Transaction => {
    let busy = false;
    const noting = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (isBusy(error)) busy = true;
        throw error;
      }
    };
    // After a busy failure the transaction is still the caller's to end; its connection is replaced once it has been given back.
    const ending = async (end: () => Promise<void>) => {
      try {
        await noting(end);
      } finally {
        if (busy) await client.reconnect();
      }
    };
    return new Proxy(tx, {
      get(target, property) {
        if (property === 'execute' || property === 'batch' || property === 'executeMultiple') {
          const method = Reflect.get(target, property, target) as (
            ...args: unknown[]
          ) => Promise<unknown>;
          return (...args: unknown[]) => noting(() => method.apply(target, args));
        }
        if (property === 'commit' || property === 'rollback') {
          const method = Reflect.get(target, property, target) as () => Promise<void>;
          return () => ending(() => method.apply(target));
        }
        if (property === 'close') {
          return () => {
            target.close();
            if (busy) void client.reconnect();
          };
        }
        return passThrough(target, property);
      },
    });
  };

  return new Proxy(client, {
    get(target, property) {
      if (
        property === 'execute' ||
        property === 'batch' ||
        property === 'migrate' ||
        property === 'executeMultiple'
      ) {
        const method = Reflect.get(target, property, target) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        return (...args: unknown[]) => recovering(() => method.apply(target, args));
      }
      if (property === 'transaction') {
        const method = Reflect.get(target, property, target) as (
          ...args: unknown[]
        ) => Promise<Transaction>;
        return async (...args: unknown[]) =>
          guardTransaction(await recovering(() => method.apply(target, args)));
      }
      return passThrough(target, property);
    },
  });
}

/**
 * Anything else, as the real object has it. libSQL's classes keep their state in private fields, which only the real object can reach, so a method
 * is bound to it and a property is read from it, never through the proxy.
 */
function passThrough(target: object, property: string | symbol): unknown {
  const value = Reflect.get(target, property, target) as unknown;
  return typeof value === 'function'
    ? (value as (...args: unknown[]) => unknown).bind(target)
    : value;
}
