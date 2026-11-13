import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes';
import { CipherError } from './errors';
import { type Aead, generateX25519, importX25519Private, keySchedule, open, seal } from './hpke';
import fixture from './hpke.vectors.json';

interface Vector {
  aead_id: number;
  info: string;
  skEm: string;
  pkEm: string;
  skRm: string;
  pkRm: string;
  enc: string;
  shared_secret: string;
  key: string;
  base_nonce: string;
  encryptions: { aad: string; ct: string; nonce: string; pt: string }[];
}

describe("HPKE's base mode, against RFC 9180's vectors", () => {
  for (const vector of fixture.vectors as Vector[]) {
    const aead = vector.aead_id as Aead;
    const first = vector.encryptions[0];
    if (!first) throw new Error('the fixture has no encryption');

    it(`seals as the RFC does (DHKEM(X25519), HKDF-SHA256, AEAD ${aead})`, async () => {
      const ephemeral = {
        privateKey: await importX25519Private(fromHex(vector.skEm), fromHex(vector.pkEm)),
        publicKey: fromHex(vector.pkEm),
      };
      const sealed = await seal(
        fromHex(vector.pkRm),
        fromHex(vector.info),
        fromHex(first.aad),
        fromHex(first.pt),
        { aead, ephemeral },
      );
      expect(toHex(sealed.enc)).toBe(vector.enc);
      expect(toHex(sealed.sharedSecret)).toBe(vector.shared_secret);
      const schedule = await keySchedule(sealed.sharedSecret, fromHex(vector.info), aead);
      expect(toHex(schedule.key)).toBe(vector.key);
      expect(toHex(schedule.baseNonce)).toBe(vector.base_nonce);
      expect(toHex(sealed.ciphertext)).toBe(first.ct);
    });

    it(`opens the RFC's ciphertext with the recipient's key (AEAD ${aead})`, async () => {
      const skR = await importX25519Private(fromHex(vector.skRm), fromHex(vector.pkRm));
      const plain = await open(
        skR,
        fromHex(vector.pkRm),
        fromHex(vector.enc),
        fromHex(vector.info),
        fromHex(first.aad),
        fromHex(first.ct),
        aead,
      );
      expect(toHex(plain)).toBe(first.pt);
    });
  }
});

describe('a wrap to a public key', () => {
  const info = new TextEncoder().encode('tally/test');
  const aad = new TextEncoder().encode('["binding"]');
  const secret = crypto.getRandomValues(new Uint8Array(32));

  it('opens with its recipient, under a fresh ephemeral key each time', async () => {
    const recipient = await generateX25519();
    const one = await seal(recipient.publicKey, info, aad, secret);
    const two = await seal(recipient.publicKey, info, aad, secret);
    expect(toHex(one.enc)).not.toBe(toHex(two.enc));
    const plain = await open(
      recipient.privateKey,
      recipient.publicKey,
      one.enc,
      info,
      aad,
      one.ciphertext,
    );
    expect(toHex(plain)).toBe(toHex(secret));
  });

  it('does not open with another key, with other bound data, or when changed', async () => {
    const recipient = await generateX25519();
    const stranger = await generateX25519();
    const { enc, ciphertext } = await seal(recipient.publicKey, info, aad, secret);
    const attempt = (
      key = recipient,
      data = aad,
      body: Uint8Array = ciphertext,
    ): Promise<unknown> => open(key.privateKey, key.publicKey, enc, info, data, body);
    await expect(attempt(stranger)).rejects.toBeInstanceOf(CipherError);
    await expect(attempt(recipient, new TextEncoder().encode('["other"]'))).rejects.toThrow(
      'tampered',
    );
    const changed = ciphertext.slice();
    changed[0] = (changed[0] ?? 0) ^ 1;
    await expect(attempt(recipient, aad, changed)).rejects.toThrow('tampered');
  });
});
