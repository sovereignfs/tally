import { authSettings } from '../auth/server';
import { getDatabase } from '../db/boot';
import { requirePerson } from '../people/session';
import { AccountShell } from './AccountShell';
import { DataSection } from './DataSection';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';
import { settingsOf } from './settings';
import { signInsOf } from './sign-ins';
import { UnlockingSection } from './UnlockingSection';

/**
 * Settings, in one place (DESIGN.md §16). The sections are server-rendered and handed to the shell, which only shows the one that is open. The name and
 * address are the person's (§6.1). Notifications join with task 9.2, This device with 6.3, export and import with 12.1 and 12.2, linking core with 2.3.
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { session, person } = await requirePerson();
  const settings = authSettings();
  const accountId = session.user.id;
  const email = person.email ?? session.user.email;
  const signIns = await signInsOf(accountId);
  const { primaryCurrency } = await settingsOf(await getDatabase(), accountId);
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: (
          <ProfileSection name={person.name} email={email} primaryCurrency={primaryCurrency} />
        ),
        security: (
          <SecuritySection
            passwordMinLength={settings?.passwordMinLength ?? 10}
            hasPassword={signIns.hasPassword}
            email={email}
            accountId={accountId}
          />
        ),
        unlocking: <UnlockingSection accountId={accountId} hasPassword={signIns.hasPassword} />,
        preferences: <PreferencesSection />,
        data: <DataSection accountId={accountId} email={email} />,
      }}
    />
  );
}
