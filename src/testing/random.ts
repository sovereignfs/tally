/**
 * A seeded random source for the property tests (DESIGN.md §20), so that a failure names its seed and runs again exactly. Mulberry32: small, fast,
 * and good enough to pick test cases; never used for anything secret.
 */
export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  chance(p: number): boolean;
}

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('nothing to pick from');
      return item;
    },
    shuffle: <T>(items: readonly T[]) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = a;
      }
      return copy;
    },
    chance: (p) => next() < p,
  };
}

/** Runs `body` for `runs` seeds, naming the seed of a failure. */
export function forSeeds(runs: number, body: (random: Random, seed: number) => void) {
  for (let seed = 1; seed <= runs; seed++) {
    try {
      body(seeded(seed), seed);
    } catch (error) {
      throw new Error(
        `failed with seed ${seed}: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  }
}
