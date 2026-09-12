### Twelve one-click deletes now ask first, and a test that can see the ones that don't (Cyrus)
`cyrus/confirm-destructive`

CLAUDE.md has said "two-step delete (never `window.confirm`)" for weeks and
about forty row components honour it. Twelve controls did not. They were bare
`<form action={deleteX}><SubmitButton>Remove</SubmitButton></form>` — one click
and the row was gone, with nothing asked and nothing recoverable from the page:
nine on `/jobs/[id]` (crew assignment, cost entry, a logged day's hours, a
dispatch slip, a wage determination, **a received payment**, a retainage
release, an executed contract document, an estimate line item), two on `/team`
(remove a teammate, cancel an invite), and the QuickBooks **Disconnect** on
`/settings`.

The worst of them was the estimate line item, where Remove was the button
immediately after Save, inside the same form, styled the same size. That one
could not be fixed in place at all — a `<form>` cannot nest inside a `<form>`,
which is why it had a `formAction` in the first place — so the delete moves out
of the edit form onto its own line. The adjacency is gone as well as the missing
confirm.

All twelve use the existing `ConfirmDelete` inside a `RowActions`; nothing new
was written. Every cluster's `pinned` value is a decision, not a default:
eleven are right-pinned (`pinned="end"`, so Cancel lands on the pixel Delete
vacated — the geometry measured at 0% overlap in #176) and the QuickBooks one is
left-aligned, so it keeps the default. Where a row had another live button —
the QuickBooks push next to a payment, the job-function picker next to Remove,
"Save as catalog item" next to a line item, "Test connection" next to
Disconnect — that button is now `children` of the `RowActions`, so arming the
delete hides it instead of leaving it under a hurried second click.

**`/team`'s three actions also threw their refusals, which production redacts.**
So a duplicate invite, a removal the database refuses, and a non-owner trying
either all looked identical: the page simply did nothing. They return
`ActionResult` now and the rows render the sentence. Two defects fell out of
that: the duplicate-invite guard tested `instanceof
Prisma.PrismaClientKnownRequestError`, which is FALSE at runtime under this
bundling (CLAUDE.md, measured 2026-08-28), so it never fired and a second invite
to the same address 500'd the page; and removing a teammate who has hours or a
dispatch slip logged is refused by the database itself (required relations
default to RESTRICT), which now reads as "clear their job function instead"
rather than as a digest.

**The check that let twelve of these exist.** `rowActionsCensus.test.ts`
scanned for hand-rolled arming state and for `ConfirmDelete` used wrongly — so
every rule it had started from something the page already HAD. A page with no
confirm at all matched nothing and read exactly like a page with nothing wrong;
`/team` was never scanned, because it never mentioned `ConfirmDelete` for the
file to have an opinion about. The new destructive-form census inverts that: it
derives the set of actions that remove rows from the action BODIES (`.delete(`,
`.deleteMany(`, a soft-delete flag — never from the name, which is how
`cancelInvite` would have been missed), then requires every `action=` /
`formAction=` attribute handing one of those to a submit control to sit on a
`<ConfirmDelete>`. A second rule covers the callback shape the converted `/team`
rows now use. Both derived sets are size-checked against a literal that cannot
drift with the pattern — 217 exported actions, 49 action attributes, five named
anchor actions — because a pattern that matches nothing is never missing
anything, which is how `scratch-cleanup-order.test.ts` stayed green at 180 of
181 foreign keys.

Proved by mutation, twice. Reverting the time-entry confirm to its old bare form
fails with `app/(app)/jobs/[id]/page.tsx:1192 <form>
deleteTimeEntryWithId(entry.id)`. Stripping the confirm out of
`CancelInviteButton.tsx` was GREEN on the first attempt — the leftover import
line satisfied the rule, the exact vacuous shape this file is a catalogue of —
so the rule now matches `<ConfirmDelete`, the element, not the identifier, and
that mutation fails too.

Known and NOT fixed here: `ChangeOrders.tsx` removes a proposal and discards a
draft from `onClick`/`onSubmit` with no confirm. Change orders are the other
lane, so it is one listed exception in the census with the reason, and a GitHub
issue — not a drive-by edit in a 2,000-line file.
