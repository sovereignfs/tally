import { authSettings } from '../auth/server';
import { getDatabase } from '../db/boot';
import { requirePerson } from '../people/session';
import { AccountShell } from './AccountShell';
import { DataSection } from './DataSection';
import { DeviceSection } from './DeviceSection';
import { NotificationsSection } from './NotificationsSection';
import { noticeMail, smtpOn } from '../notices/mail';
import { prefsOf } from '../notices/prefs';
import { NOTICE_KINDS } from '../notices/kinds';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';
import { settingsOf } from './settings';
import { signInsOf } from './sign-ins';
import { UnlockingSection } from './UnlockingSection';

/**
 * Settings, in one place (DESIGN.md §16). The sections are server-rendered and handed to the shell, which only shows the one that is open. The name and
 * address are the person's (§6.1). Notifications are §12.3's, export and import with 12.1 and 12.2, linking core in Security (§14.2).
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { session, person } = await requirePerson();
  const settings = authSettings();
  const accountId = session.user.id;
  const address = person.email ?? session.user.email;
  const signIns = await signInsOf(accountId);
  const { primaryCurrency } = await settingsOf(await getDatabase(), accountId);
  const prefs = await prefsOf(await getDatabase(), accountId);
  const email = Object.fromEntries(NOTICE_KINDS.map((kind) => [kind, prefs[kind].email])) as Record<
    (typeof NOTICE_KINDS)[number],
    boolean
  >;
  const bell = Object.fromEntries(
    NOTICE_KINDS.map((kind) => [kind, prefs[kind].core_bell]),
  ) as Record<(typeof NOTICE_KINDS)[number], boolean>;
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: (
          <ProfileSection name={person.name} email={address} primaryCurrency={primaryCurrency} />
        ),
        security: (
          <SecuritySection
            passwordMinLength={settings?.passwordMinLength ?? 10}
            hasPassword={signIns.hasPassword}
            email={address}
            accountId={accountId}
            sovereign={
              settings?.sovereign ? { linkedAccountId: signIns.sovereignAccountId } : undefined
            }
            result={{
              linked: query.linked === '1',
              unlinked: query.unlinked === '1',
              error: query.error ?? null,
            }}
          />
        ),
        unlocking: <UnlockingSection accountId={accountId} hasPassword={signIns.hasPassword} />,
        preferences: <PreferencesSection />,
        device: <DeviceSection accountId={accountId} />,
        notifications: (
          <NotificationsSection
            email={email}
            bell={bell}
            mailOn={smtpOn(noticeMail()) || signIns.sovereignAccountId !== null}
            core={settings?.sovereign ? { linked: signIns.sovereignAccountId !== null } : null}
          />
        ),
        data: (
          <DataSection
            accountId={accountId}
            email={address}
            profile={{
              name: person.name,
              email: address,
              primaryCurrency,
              notifications: Object.fromEntries(
                NOTICE_KINDS.map((kind) => [
                  kind,
                  { email: prefs[kind].email, coreBell: prefs[kind].core_bell },
                ]),
              ),
            }}
          />
        ),
      }}
    />
  );
}
