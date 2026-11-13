import { describe, expect, it } from 'vitest';
import { type Minor, addMinor, toMinor } from './amount';

/**
 * **A float never reaches an amount** (task 4.1), held by the compiler: each line marked `@ts-expect-error` must fail to type-check, and `pnpm
 * typecheck` fails if one of them does not (an unused `@ts-expect-error` is an error). The test at run time only shows the file is run.
 */
function store(_amount: Minor): void {}

describe('the type of an amount', () => {
  it('takes a checked amount, and not a number', () => {
    store(toMinor(340));
    store(addMinor(toMinor(1), toMinor(2)));
    // @ts-expect-error a float is not an amount
    store(12.5);
    // @ts-expect-error nor is a whole number that has not been checked
    store(340);
    const typed: number = Number('12.5');
    // @ts-expect-error nor is a number from anywhere else
    store(typed);
    // @ts-expect-error and arithmetic on amounts is a number again, until it is checked
    store(toMinor(1) + toMinor(2));
    expect(true).toBe(true);
  });
});
