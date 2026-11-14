import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from '../config';

const SECRET = 'a-secret-that-is-at-least-thirty-two-characters-long';
const ON = {
  TALLY_URL: 'https://tally.example.com',
  TALLY_AUTH_LOCAL: '1',
  TALLY_AUTH_SECRET: SECRET,
};
const CORE = {
  TALLY_CORE_URL: 'https://sovereign.example.com',
  TALLY_CORE_CLIENT_ID: 'tally-client',
  TALLY_CORE_CLIENT_SECRET: 'tally-client-secret',
};

function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

function authOf(result: LoadResult) {
  if (!result.ok) throw new Error(result.problems.join(' '));
  return result.config.auth;
}

describe('sign-in settings', () => {
  it('are off when local sign-in is not asked for, and then nothing else of them is read', () => {
    expect(authOf(loadConfig({}))).toBeUndefined();
    expect(
      authOf(loadConfig({ TALLY_AUTH_LOCAL: '0', TALLY_AUTH_SECRET: 'short' })),
    ).toBeUndefined();
    expect(authOf(loadConfig({ TALLY_AUTH_LOCAL: 'false' }))).toBeUndefined();
  });

  it('are on with an address and a secret, and sign-up is by invitation unless it is said to be open or closed', () => {
    expect(authOf(loadConfig(ON))).toEqual({
      url: 'https://tally.example.com',
      secret: SECRET,
      signUp: 'invite',
      passwordMinLength: 10,
      local: true,
      sovereign: undefined,
    });
    expect(
      authOf(loadConfig({ ...ON, TALLY_AUTH_LOCAL: 'true', TALLY_AUTH_SIGNUP: 'OPEN' })),
    ).toMatchObject({
      signUp: 'open',
    });
    expect(authOf(loadConfig({ ...ON, TALLY_AUTH_SIGNUP: 'closed' }))).toMatchObject({
      signUp: 'closed',
    });
    expect(authOf(loadConfig({ ...ON, TALLY_AUTH_PASSWORD_MIN_LENGTH: '14' }))).toMatchObject({
      passwordMinLength: 14,
    });
  });

  it('read the secret from a file, and keep it out of what they report', () => {
    const result = loadConfig(
      { ...ON, TALLY_AUTH_SECRET: undefined, TALLY_AUTH_SECRET_FILE: '/run/secret' },
      () => `${SECRET}\n`,
    );
    expect(authOf(result)).toMatchObject({ secret: SECRET });
    const short = problems(loadConfig({ ...ON, TALLY_AUTH_SECRET: 'hunter2' })).join(' ');
    expect(short).toContain('TALLY_AUTH_SECRET');
    expect(short).not.toContain('hunter2');
  });

  it('stop the server when a way is on and a thing it needs is missing or wrong', () => {
    expect(problems(loadConfig({ ...ON, TALLY_AUTH_SECRET: undefined })).join(' ')).toContain(
      'TALLY_AUTH_SECRET',
    );
    expect(problems(loadConfig({ ...ON, TALLY_URL: undefined })).join(' ')).toContain('TALLY_URL');
    expect(problems(loadConfig({ ...ON, TALLY_AUTH_SIGNUP: 'anyone' })).join(' ')).toContain(
      'TALLY_AUTH_SIGNUP',
    );
    expect(problems(loadConfig({ ...ON, TALLY_AUTH_LOCAL: 'yes' })).join(' ')).toContain(
      'TALLY_AUTH_LOCAL',
    );
    for (const bad of ['3', '1000', 'ten'])
      expect(
        problems(loadConfig({ ...ON, TALLY_AUTH_PASSWORD_MIN_LENGTH: bad })).join(' '),
      ).toContain('TALLY_AUTH_PASSWORD_MIN_LENGTH');
  });

  it('say about a wrong address only once: the address check already reported it', () => {
    const reported = problems(loadConfig({ ...ON, TALLY_URL: 'http://tally.example.com' }));
    expect(reported.filter((problem) => problem.includes('TALLY_URL'))).toHaveLength(1);
  });

  // From Tusk's `src/auth/config.test.ts`, with Tally's sign-up: it governs local accounts, and core's are made whatever it says (§6.4).
  it('are on with a core alone: Sovereign sign-in with no password, still needing an address and a secret', () => {
    const only = { TALLY_URL: ON.TALLY_URL, TALLY_AUTH_SECRET: SECRET, ...CORE };
    expect(authOf(loadConfig(only))).toEqual({
      url: 'https://tally.example.com',
      secret: SECRET,
      signUp: 'invite',
      passwordMinLength: 10,
      local: false,
      sovereign: {
        issuer: 'https://sovereign.example.com',
        clientId: 'tally-client',
        clientSecret: 'tally-client-secret',
      },
    });
    expect(authOf(loadConfig({ ...only, TALLY_AUTH_LOCAL: '1' }))).toMatchObject({
      local: true,
      sovereign: { clientId: 'tally-client' },
    });
    expect(problems(loadConfig({ ...CORE, TALLY_AUTH_SECRET: SECRET })).join(' ')).toContain(
      'Sovereign sign-in is set, so TALLY_URL',
    );
    expect(problems(loadConfig({ ...CORE, TALLY_URL: ON.TALLY_URL })).join(' ')).toContain(
      'TALLY_AUTH_SECRET',
    );
  });

  it('read the client secret from a file', () => {
    const result = loadConfig(
      { ...ON, ...CORE, TALLY_CORE_CLIENT_SECRET: undefined, TALLY_CORE_CLIENT_SECRET_FILE: '/s' },
      () => 'from-a-file\n',
    );
    expect(authOf(result)).toMatchObject({ sovereign: { clientSecret: 'from-a-file' } });
  });

  it('stop the server on a partial set of core settings, and on a core address that would send the secret in the clear', () => {
    for (const missing of Object.keys(CORE)) {
      const partial = { ...ON, ...CORE, [missing]: undefined };
      expect(problems(loadConfig(partial)).join(' ')).toContain(missing);
    }
    const insecure = problems(
      loadConfig({ ...ON, ...CORE, TALLY_CORE_URL: 'http://sovereign.example.com' }),
    ).join(' ');
    expect(insecure).toContain('TALLY_CORE_URL must be https');
    expect(insecure).not.toContain('tally-client-secret');
    expect(
      authOf(loadConfig({ ...ON, ...CORE, TALLY_CORE_URL: 'http://localhost:4000/' })),
    ).toMatchObject({ sovereign: { issuer: 'http://localhost:4000' } });
    expect(
      authOf(loadConfig({ ...ON, ...CORE, TALLY_CORE_URL: 'https://core.example.com/api/auth/' })),
    ).toMatchObject({ sovereign: { issuer: 'https://core.example.com/api/auth' } });
    for (const bad of [
      'not an address',
      'https://core.example.com/?x=1',
      'https://u:p@core.example.com',
    ])
      expect(problems(loadConfig({ ...ON, ...CORE, TALLY_CORE_URL: bad })).join(' ')).toContain(
        'TALLY_CORE_URL',
      );
  });
});
