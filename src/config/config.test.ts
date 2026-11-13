import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from './index';
import { readEnvironment, readSecret } from './env';

/** The problems of a bad environment, which every test below wants to read and none expects to be empty. */
function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

describe('loadConfig', () => {
  it('accepts no settings at all: the worker is on, and there is no address or key', () => {
    expect(loadConfig({})).toMatchObject({
      ok: true,
      config: {
        url: undefined,
        worker: true,
        encryption: undefined,
      },
    });
  });

  describe('TALLY_URL', () => {
    it('keeps the origin of an https address', () => {
      expect(loadConfig({ TALLY_URL: 'https://tally.example.com/' })).toMatchObject({
        ok: true,
        config: { url: 'https://tally.example.com' },
      });
    });

    it.each([
      'http://localhost:3004',
      'http://127.0.0.1:3004',
      'http://[::1]:3004',
      'http://x.localhost',
    ])('allows plain http on this machine: %s', (url) => {
      expect(loadConfig({ TALLY_URL: url }).ok).toBe(true);
    });

    it('refuses plain http anywhere else, naming the setting and not the value', () => {
      const [problem] = problems(loadConfig({ TALLY_URL: 'http://tally.example.com' }));
      expect(problem).toContain('TALLY_URL');
      expect(problem).not.toContain('tally.example.com');
    });

    it.each([
      ['not an address', 'not-an-address-value'],
      ['another scheme', 'ftp://tally.example.com'],
      ['a path', 'https://tally.example.com/app'],
      ['a query', 'https://tally.example.com/?a=1'],
      ['a user name', 'https://me:secret@tally.example.com'],
    ])('refuses %s, and never prints it', (_what, url) => {
      const result = problems(loadConfig({ TALLY_URL: url }));
      expect(result.join(' ')).toContain('TALLY_URL');
      expect(result.join(' ')).not.toContain('secret');
      expect(result.join(' ')).not.toContain(url);
    });
  });

  describe('TALLY_WORKER', () => {
    it('is on unless it says off', () => {
      expect(loadConfig({ TALLY_WORKER: 'off' })).toMatchObject({ config: { worker: false } });
      expect(loadConfig({ TALLY_WORKER: 'on' })).toMatchObject({ config: { worker: true } });
    });

    it('refuses anything else', () => {
      expect(problems(loadConfig({ TALLY_WORKER: 'yes' }))[0]).toContain('TALLY_WORKER');
    });
  });

  describe('settings that go together', () => {
    it.each(['TALLY_CORE_URL', 'TALLY_CORE_CLIENT_ID'])('stops on %s given alone', (name) => {
      const [problem] = problems(loadConfig({ [name]: 'value-that-must-not-appear' }));
      expect(problem).toContain('Sovereign sign-in');
      expect(problem).not.toContain('value-that-must-not-appear');
    });

    it('names what is missing', () => {
      const [problem] = problems(
        loadConfig({ TALLY_CORE_URL: 'https://core.example.com', TALLY_CORE_CLIENT_ID: 'a' }),
      );
      expect(problem).toContain('TALLY_CORE_CLIENT_SECRET is missing');
    });

    it('accepts all of a group, and counts a secret given as a file as given', () => {
      const files: Record<string, string> = { '/run/secret': 's3cret\n' };
      expect(
        loadConfig(
          {
            TALLY_CORE_URL: 'https://core.example.com',
            TALLY_CORE_CLIENT_ID: 'a',
            TALLY_CORE_CLIENT_SECRET_FILE: '/run/secret',
          },
          (path) => files[path] ?? '',
        ).ok,
      ).toBe(true);
    });
  });

  describe('the instance key', () => {
    const key = Buffer.alloc(32, 7);
    const other = Buffer.alloc(32, 9);
    const ringOf = (result: LoadResult) => (result.ok ? result.config.encryption : undefined);

    it('is optional: with none there is no ring, and nothing is wrong', () => {
      const result = loadConfig({});
      expect(result.ok && result.config.encryption).toBeUndefined();
    });

    it('is read in base64, URL-safe base64 and hex, from the setting or its file, and known by a fingerprint', () => {
      for (const text of [key.toString('base64'), key.toString('base64url'), key.toString('hex')]) {
        const ring = ringOf(loadConfig({ TALLY_ENCRYPTION_KEY: text }));
        expect(ring?.current.key.equals(key), text).toBe(true);
        expect(ring?.current.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(ring?.previous).toBeUndefined();
      }
      const fromFile = ringOf(
        loadConfig({ TALLY_ENCRYPTION_KEY_FILE: '/run/key' }, () => `${key.toString('base64')}\n`),
      );
      expect(fromFile?.current.key.equals(key)).toBe(true);
    });

    it('may have the key it replaces beside it', () => {
      const ring = ringOf(
        loadConfig({
          TALLY_ENCRYPTION_KEY: key.toString('hex'),
          TALLY_ENCRYPTION_KEY_PREVIOUS: other.toString('hex'),
        }),
      );
      expect(ring?.current.key.equals(key)).toBe(true);
      expect(ring?.previous?.key.equals(other)).toBe(true);
      expect(ring?.previous?.fingerprint).not.toBe(ring?.current.fingerprint);
    });

    it('stops the server for a key that is not one, a previous key with no current one, and the same key twice, never printing a value', () => {
      const secret = 'hunter2-NOT-A-KEY';
      const wrong = problems(loadConfig({ TALLY_ENCRYPTION_KEY: secret }));
      expect(wrong.join(' ')).toContain('TALLY_ENCRYPTION_KEY is not a key');
      expect(
        problems(loadConfig({ TALLY_ENCRYPTION_KEY: Buffer.alloc(16).toString('hex') })).join(' '),
      ).toContain('not a key');
      const badPrevious = problems(
        loadConfig({
          TALLY_ENCRYPTION_KEY: key.toString('hex'),
          TALLY_ENCRYPTION_KEY_PREVIOUS: secret,
        }),
      );
      expect(badPrevious.join(' ')).toContain('TALLY_ENCRYPTION_KEY_PREVIOUS is not a key');
      expect(
        problems(loadConfig({ TALLY_ENCRYPTION_KEY_PREVIOUS: key.toString('hex') })).join(' '),
      ).toContain('no TALLY_ENCRYPTION_KEY to move');
      expect(
        problems(
          loadConfig({
            TALLY_ENCRYPTION_KEY: key.toString('hex'),
            TALLY_ENCRYPTION_KEY_PREVIOUS: key.toString('base64'),
          }),
        ).join(' '),
      ).toContain('the same key');
      for (const message of [...wrong, ...badPrevious]) expect(message).not.toContain(secret);
    });
  });

  it('reports every problem at once, so that one run fixes them all', () => {
    expect(
      problems(loadConfig({ TALLY_URL: 'tally', TALLY_WORKER: 'x', TALLY_CORE_URL: 'k' })),
    ).toHaveLength(3);
  });

  it('turns an unreadable secret file into a problem that names the variable and not the path', () => {
    const result = problems(
      loadConfig({ TALLY_AUTH_SECRET_FILE: '/run/secrets/nowhere' }, () => {
        throw new Error('ENOENT /run/secrets/nowhere');
      }),
    );
    expect(result.join(' ')).toContain('TALLY_AUTH_SECRET_FILE');
    expect(result.join(' ')).not.toContain('/run/secrets/nowhere');
  });
});

describe('reading the environment', () => {
  const read = (env: Record<string, string | undefined>, name: string, readFile?: () => string) => {
    const reading = readEnvironment(env, readFile);
    if (!reading.ok) throw new Error(reading.problems.join(' '));
    return reading.read(name);
  };

  it('reads the plain name', () => {
    expect(read({ TALLY_URL: 'a' }, 'TALLY_URL')).toBe('a');
  });

  it('reads a secret from its file, trimmed', () => {
    expect(read({ TALLY_AUTH_SECRET_FILE: '/run/s' }, 'TALLY_AUTH_SECRET', () => 's3cret\n')).toBe(
      's3cret',
    );
  });

  it('refuses a secret given both ways, and a file for a setting that is not a secret', () => {
    const both = readEnvironment({ TALLY_AUTH_SECRET: 'a', TALLY_AUTH_SECRET_FILE: '/x' });
    expect(both.ok).toBe(false);
    const text = readEnvironment({ TALLY_URL_FILE: '/x' });
    expect(text).toMatchObject({ ok: false });
    expect(text.ok ? '' : text.problems.join(' ')).toContain('TALLY_URL_FILE');
  });

  it('treats a blank value as not given', () => {
    expect(read({ TALLY_URL: '   ' }, 'TALLY_URL')).toBeUndefined();
  });

  it('readSecret reads one secret alone', () => {
    expect(readSecret({ TALLY_ENCRYPTION_KEY: 'k' }, 'TALLY_ENCRYPTION_KEY')).toBe('k');
  });
});
