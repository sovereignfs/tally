# What is sealed, and what cannot be hidden

## Sealed: only a group's members read it

**A group's name, and every description, note and comment in it,** are sealed in your browser with the group's key before they leave your device.
The server stores them sealed and never holds a key that opens them, so neither the people who run the server nor anyone who copies its database can
read them. They are opened on your devices, and on the devices of the other members.

You do not handle any key. Your password, or your passkey, unlocks your groups on a new device as it signs you in; another of your devices can unlock
it too ("Allow your new phone to open your groups?"). A **recovery key** is offered once, after you sign up: it unlocks every group on a device when
nothing else can. You can skip it; losing it costs nothing while another member of each group remains.

Until a group is unlocked on a device, its figures and balances show as usual, and what was written in it shows as "…".

## Not sealed: what the server needs to work

So that the server can check that an expense adds up, work out balances, send reminders and tell people what concerns them, these are **not**
sealed, and whoever runs the server can read them:

- **people's names,** in every group they are in, and **who is in which group**;
- **amounts, currencies, dates and categories** of expenses and payments, and **who paid and who shares**;
- **when** things were recorded and changed, and by whom.

Tally is not "zero-knowledge", and does not say it is.

## Who sees your email address

- **You,** always.
- **The person who added you as not on Tally yet,** to send you an invitation.
- Nobody else in your groups, and never in a notice, an email to someone else, the activity of a group, or another person's export.

## Emails and notifications

What Tally emails, and what it sends to a Sovereign instance's bell, says who did what and how much, with a link: "Ada added an expense of €84.00 in a
group on Tally". It never says what was written, or the group's name, since those are sealed.
