import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url, toHex } from './bytes';
import { CipherError } from './errors';
import { exportX25519Private, generateX25519, importX25519Private } from './hpke';
import { PASSWORD_V1, derivePassword, passwordSalt } from './password';
import { prfSecret } from './prf';
import { newRecoverySecret, parseRecoveryCode, recoveryCode } from './recovery';
import {
  type RowBinding,
  epochOf,
  importGroupKey,
  newGroupKey,
  openRow,
  parseSealed,
  sealRow,
} from './seal';
import { deleteVault, openVault } from './vault';
import { unwrapWithPrivateKey, unwrapWithSecret, wrapToPublicKey, wrapToSecret } from './wrap';

const row: RowBinding = { group: 'g1', table: 'expense', row: 'e1' };

describe('a sealed row', () => {
  it('opens with its own key, group, table, row and epoch, and gives back what was sealed', async () => {
    const key = await importGroupKey(newGroupKey());
    const sealed = await sealRow({ description: 'Dinner at Ramiro', note: null }, key, 3, row);
    expect(sealed).toMatch(/^s1\.3\.[A-Za-z0-9_-]+$/);
    expect(epochOf(sealed)).toBe(3);
    expect(await openRow(sealed, key, row)).toEqual({
      description: 'Dinner at Ramiro',
      note: null,
    });
  });

  it('does not open in another group, table or row, under another epoch, with another key, or changed', async () => {
    const key = await importGroupKey(newGroupKey());
    const sealed = await sealRow({ description: 'Tram' }, key, 1, row);
    const refused = (value: string, binding: RowBinding, withKey = key) =>
      expect(openRow(value, withKey, binding)).rejects.toThrow('tampered');
    await refused(sealed, { ...row, group: 'g2' });
    await refused(sealed, { ...row, table: 'payment' });
    await refused(sealed, { ...row, row: 'e2' });
    await refused(sealed.replace(/^s1\.1\./, 's1.2.'), row);
    await refused(sealed, row, await importGroupKey(newGroupKey()));
    const body = sealed.split('.')[2] ?? '';
    const bytes = fromBase64Url(body);
    if (!bytes) throw new Error('not base64url');
    bytes[20] = (bytes[20] ?? 0) ^ 1;
    await refused(`s1.1.${toBase64Url(bytes)}`, row);
  });

  it('is malformed, not tampered, when it is not a sealed value at all', async () => {
    const key = await importGroupKey(newGroupKey());
    for (const value of [
      '',
      'plain text',
      's2.1.AAAA',
      's1.0.AAAA',
      's1.x.AAAA',
      's1.1.AA=A',
      's1.1.AAAA',
    ]) {
      await expect(openRow(value, key, row)).rejects.toThrow('malformed');
      expect(() => parseSealed(value)).toThrow(CipherError);
    }
  });

  it('says little about the length: texts in one bucket seal to one length', async () => {
    const key = await importGroupKey(newGroupKey());
    const lengthOf = async (description: string) =>
      (await sealRow({ description }, key, 1, row)).length;
    // `{"description":"…"}` is 18 bytes and the text: 'a' and 'ten letter' both fall in the first 32.
    expect(await lengthOf('a')).toBe(await lengthOf('ten letter'));
    expect(await lengthOf('x'.repeat(40))).toBeGreaterThan(await lengthOf('x'));
  });

  it('is new each time: the same text sealed twice is two different values', async () => {
    const key = await importGroupKey(newGroupKey());
    const one = await sealRow({ body: 'same' }, key, 1, row);
    const two = await sealRow({ body: 'same' }, key, 1, row);
    expect(one).not.toBe(two);
  });
});

describe('a key wrapped to a public key', () => {
  it('opens with the recipient for its binding, and is the wrong key for anyone or anything else', async () => {
    const member = await generateX25519();
    const other = await generateX25519();
    const groupKey = newGroupKey();
    const binding = ['g1', 2, 'account-1'];
    const wrapped = await wrapToPublicKey(groupKey, member.publicKey, binding);
    expect(wrapped).toMatch(/^h1\.[A-Za-z0-9_-]+$/);
    expect(
      toHex(await unwrapWithPrivateKey(wrapped, member.privateKey, member.publicKey, binding)),
    ).toBe(toHex(groupKey));
    await expect(
      unwrapWithPrivateKey(wrapped, other.privateKey, other.publicKey, binding),
    ).rejects.toThrow('wrong_key');
    await expect(
      unwrapWithPrivateKey(wrapped, member.privateKey, member.publicKey, ['g2', 2, 'account-1']),
    ).rejects.toThrow('wrong_key');
    await expect(
      unwrapWithPrivateKey('h1.!!', member.privateKey, member.publicKey, binding),
    ).rejects.toThrow('malformed');
  });

  it('survives the private key being kept as bytes and imported again', async () => {
    const account = await generateX25519(true);
    const restored = await importX25519Private(
      await exportX25519Private(account.privateKey),
      account.publicKey,
    );
    const wrapped = await wrapToPublicKey(new Uint8Array(32).fill(7), account.publicKey, ['x']);
    expect(await unwrapWithPrivateKey(wrapped, restored, account.publicKey, ['x'])).toEqual(
      new Uint8Array(32).fill(7),
    );
  });
});

describe('a key wrapped to a secret', () => {
  it('opens with the same secret, purpose and binding, and is the wrong key otherwise', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const accountKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapToSecret(accountKey, secret, 'password', ['account-1']);
    expect(wrapped).toMatch(/^w1\./);
    expect(await unwrapWithSecret(wrapped, secret, 'password', ['account-1'])).toEqual(accountKey);
    const wrong = crypto.getRandomValues(new Uint8Array(32));
    await expect(unwrapWithSecret(wrapped, wrong, 'password', ['account-1'])).rejects.toThrow(
      'wrong_key',
    );
    await expect(unwrapWithSecret(wrapped, secret, 'recovery', ['account-1'])).rejects.toThrow(
      'wrong_key',
    );
    await expect(unwrapWithSecret(wrapped, secret, 'password', ['account-2'])).rejects.toThrow(
      'wrong_key',
    );
    await expect(unwrapWithSecret('w1.x', secret, 'password', ['account-1'])).rejects.toThrow(
      'malformed',
    );
  });
});

describe('the password', () => {
  const origin = 'https://tally.example.com';

  it('gives two values, neither the other, the same each time for the same password, address and instance', async () => {
    const one = await derivePassword('correct horse battery', origin, 'Ada@Example.com');
    const two = await derivePassword('correct horse battery', origin, 'ada@example.com');
    expect(one.signIn).toBe(two.signIn);
    expect(toHex(one.unwrap)).toBe(toHex(two.unwrap));
    expect(fromBase64Url(one.signIn)).toHaveLength(32);
    expect(one.unwrap).toHaveLength(32);
    expect(toHex(fromBase64Url(one.signIn) ?? new Uint8Array())).not.toBe(toHex(one.unwrap));
    // The value sent to sign in is not the password, and does not contain it.
    expect(one.signIn).not.toContain('correct');
  });

  it('differs for another password, another address and another instance', async () => {
    const base = await derivePassword('correct horse battery', origin, 'ada@example.com');
    const others = await Promise.all([
      derivePassword('correct horse batterz', origin, 'ada@example.com'),
      derivePassword('correct horse battery', origin, 'bob@example.com'),
      derivePassword('correct horse battery', 'https://other.example.com', 'ada@example.com'),
    ]);
    for (const other of others) {
      expect(other.signIn).not.toBe(base.signIn);
      expect(toHex(other.unwrap)).not.toBe(toHex(base.unwrap));
    }
  });

  it('is salted by the instance and the address alone, and ignores a path on the address', async () => {
    expect(toHex(await passwordSalt('https://tally.example.com/x', 'A@B.c'))).toBe(
      toHex(await passwordSalt('https://tally.example.com', 'a@b.c')),
    );
  });

  it('uses the parameters of the design: 64 MiB, 3 passes, 4 lanes', () => {
    expect(PASSWORD_V1).toEqual({ version: 1, memoryKiB: 65536, iterations: 3, parallelism: 4 });
  });

  it('takes under a second here (a phone is slower; the figure is reported in the task)', async () => {
    const started = performance.now();
    await derivePassword('timing', origin, 'ada@example.com');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('the recovery code', () => {
  it('reads back what it was made from, however it is retyped', async () => {
    const secret = newRecoverySecret();
    const code = await recoveryCode(secret);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    const retyped = [
      code,
      code.toLowerCase(),
      code.replace(/-/g, ' '),
      ` ${code.replace(/-/g, '')} `,
    ];
    for (const typed of retyped) expect(toHex(await parseRecoveryCode(typed))).toBe(toHex(secret));
    // The letters people write for 0 and 1.
    const zeroed = code.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(toHex(await parseRecoveryCode(zeroed))).toBe(toHex(secret));
  });

  it('refuses a code with one character wrong, or of the wrong length', async () => {
    const code = await recoveryCode(newRecoverySecret());
    const first = code[0] === 'A' ? 'B' : 'A';
    await expect(parseRecoveryCode(first + code.slice(1))).rejects.toThrow('malformed');
    await expect(parseRecoveryCode(code.slice(0, -1))).rejects.toThrow('malformed');
    await expect(parseRecoveryCode('not a code')).rejects.toThrow('malformed');
  });
});

describe('a passkey’s PRF output', () => {
  it('is read from the extension results, and its absence is no secret', () => {
    const first = new Uint8Array(32).fill(9).buffer;
    expect(prfSecret({ prf: { results: { first } } })).toEqual(new Uint8Array(32).fill(9));
    expect(prfSecret({ prf: { enabled: true } })).toBeUndefined();
    expect(prfSecret({})).toBeUndefined();
    expect(() => prfSecret({ prf: { results: { first: new Uint8Array(4) } } })).toThrow(
      'malformed',
    );
  });
});

describe('the vault on this device', () => {
  it('keeps a secret sealed, gives it back, and is gone when deleted', async () => {
    const vault = await openVault('account-1');
    const secret = crypto.getRandomValues(new Uint8Array(32));
    await vault.put('account-key', secret);
    expect(await vault.get('account-key')).toEqual(secret);
    expect(await vault.get('nothing')).toBeUndefined();
    await vault.remove('account-key');
    expect(await vault.get('account-key')).toBeUndefined();
    await vault.put('account-key', secret);
    vault.close();

    // Kept across opening it again, as across a reload.
    const again = await openVault('account-1');
    expect(await again.get('account-key')).toEqual(secret);
    again.close();

    await deleteVault('account-1');
    const fresh = await openVault('account-1');
    expect(await fresh.get('account-key')).toBeUndefined();
    fresh.close();
  });

  it('keeps one account’s keys apart from another’s', async () => {
    const one = await openVault('account-a');
    const two = await openVault('account-b');
    await one.put('k', new Uint8Array([1]));
    expect(await two.get('k')).toBeUndefined();
    one.close();
    two.close();
  });
});

describe('the cipher', () => {
  it('imports nothing of the server, the database or Node', () => {
    const folder = path.resolve(__dirname);
    for (const file of readdirSync(folder).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )) {
      const source = readFileSync(path.join(folder, file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
      for (const target of imports) {
        expect(target.startsWith('./') || target === 'hash-wasm', `${file} imports ${target}`).toBe(
          true,
        );
      }
    }
  });
});

describe('the vault, deleted while it is open', () => {
  it('is deleted, not left waiting for the page that has it open', async () => {
    const open = await openVault('account-open');
    await open.put('k', new Uint8Array([1]));
    // Not closed: as the shell holds it while the person signs out.
    await deleteVault('account-open');
    const fresh = await openVault('account-open');
    expect(await fresh.get('k')).toBeUndefined();
    fresh.close();
  });
});
