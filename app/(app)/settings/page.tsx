import { AccountPanel } from '@/src/account/AccountPanel';
import { one } from '@/src/account/query';
import { requirePerson } from '@/src/people/session';

export const metadata = { title: 'Settings' };

/** Settings (DESIGN.md §16), also from the avatar menu. `?section=` opens one of its parts. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePerson();
  const query = await searchParams;
  return <AccountPanel query={{ section: one(query.section) }} />;
}
