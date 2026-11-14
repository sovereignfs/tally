import { DeleteAccountSection } from './DeleteAccountSection';

/**
 * Settings, Data (DESIGN.md §16): what ends. Deleting the account is here; export and import join with tasks 12.1 and 12.2.
 */
export function DataSection({ accountId, email }: { accountId: string; email: string }) {
  return <DeleteAccountSection accountId={accountId} email={email} />;
}
