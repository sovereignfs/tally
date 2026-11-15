import type { ExportFile } from '../portability/format';
import { DeleteAccountSection } from './DeleteAccountSection';
import { ExportSection } from './ExportSection';
import { ImportSection } from './ImportSection';

/**
 * Settings, Data (DESIGN.md §16, §17): taking your data with you, bringing a file in as new groups, and deleting the account.
 */
export function DataSection({
  accountId,
  email,
  profile,
}: {
  accountId: string;
  email: string;
  profile: ExportFile['profile'];
}) {
  return (
    <>
      <ExportSection profile={profile} />
      <ImportSection name={profile.name} />
      <DeleteAccountSection accountId={accountId} email={email} />
    </>
  );
}
