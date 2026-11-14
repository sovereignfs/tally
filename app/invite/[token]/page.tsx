import { AuthLink } from '@sovereignfs/ui';
import { authSettings, signUpAvailable } from '@/src/auth/server';
import { AuthShell } from '@/src/auth/screens/AuthShell';
import { getSession } from '@/src/auth/session';
import { getDatabase } from '@/src/db/boot';
import { AcceptInvitation } from '@/src/invites/AcceptInvitation';
import { InviteGroupName } from '@/src/invites/InviteGroupName';
import { validInvitation } from '@/src/invites/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'An invitation', robots: { index: false, follow: false } };

/**
 * An invitation (DESIGN.md §6.3), for anyone holding the link. It says who invited, and nothing else the server knows: the group's name is sealed, and
 * shown only once the device opens it with the key the link may carry (15.5). Signed in, it is accepted here; otherwise it offers to make an account
 * (allowed for an invitation when sign-up is by invitation, §6.4) or to sign in. **Every invalid link shows the same page**, whatever the reason.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await validInvitation(await getDatabase(), token, Date.now());
  if (!invitation)
    return (
      <AuthShell
        title="This invitation cannot be used"
        lead="It may have been used already, ended, or been taken back. Ask whoever sent it for a new one."
        footer={<AuthLink href="/">Go to Tally</AuthLink>}
        footerAlign="start"
      />
    );
  const session = await getSession();
  const lead = `${invitation.inviterName} added you to a group on Tally, to share expenses.`;
  if (session)
    return (
      <AuthShell title="You are invited" lead={lead}>
        <InviteGroupName
          groupId={invitation.groupId}
          keyWrap={invitation.keyWrap}
          groupSealed={invitation.groupSealed}
        />
        <AcceptInvitation
          token={token}
          groupId={invitation.groupId}
          accountId={session.user.id}
          keyWrap={invitation.keyWrap}
        />
      </AuthShell>
    );
  const settings = authSettings();
  const canSignUp = await signUpAvailable(token);
  return (
    <AuthShell
      title="You are invited"
      lead={`${lead} Make an account, or sign in, to take your place.`}
      footer={
        settings?.local ? (
          <>
            {canSignUp ? (
              <>
                <AuthLink href={`/sign-up?invite=${token}`}>Create an account</AuthLink>
                {' · '}
              </>
            ) : null}
            <AuthLink href={`/sign-in?next=/invite/${token}`}>I have an account</AuthLink>
          </>
        ) : null
      }
      footerAlign="start"
    >
      <InviteGroupName
        groupId={invitation.groupId}
        keyWrap={invitation.keyWrap}
        groupSealed={invitation.groupSealed}
      />
    </AuthShell>
  );
}
