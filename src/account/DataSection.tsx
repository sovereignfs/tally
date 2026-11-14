import type { ExportFile } from '../portability/format';
import { DeleteAccountSection } from './DeleteAccountSection';
import { ExportSection } from './ExportSection';

/**
 * Settings, Data (DESIGN.md §16, §17): taking your data with you, and deleting the account. Import joins with task 12.2.
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
      <DeleteAccountSection accountId={accountId} email={email} />
    </>
  );
}
