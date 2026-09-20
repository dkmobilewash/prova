### The punch list stops being a checkbox (Diego)
`diego/punch-list-verified`

A punch item was a description, `isDone` and `completedAt`. No area, no
assignee, no due date, no photos, no link to anything, and — the expensive
one — no gap between "the crew says it is fixed" and "somebody who did not
do the work agrees". One checkbox made the person who did the work the only
witness that it was done, which is exactly the boundary a sub and a GC
argue over on the walkthrough.

So an item now runs OPEN → READY_FOR_REVIEW → VERIFIED. Marking one ready
is field work and one tap; verifying it needs `VERIFY_PUNCH_ITEMS`, a new
capability the FIELD job function deliberately does not hold. Sending one
back requires a typed reason — the one place this feature insists on
typing, because "it was closed and then it was open again" with nothing to
say why is the argument this record exists to settle months later.
Reversing somebody's verification takes whatever could have signed it,
which is not symmetric with sending back the crew's own claim and should
not be.

Also on an item: where it is, who is fixing it, when it is due, and whether
somebody else caused it. The assignee is three mutually exclusive columns
rather than a relation to `User`, because most people who fix punch items
have no login — a picker that only listed users would have sat empty. At
most one is ever set, and the database enforces that rather than trusting
every writer.

**The backcharge link is the point of the whole change.** A punch item can
be marked as not our scope, with who caused it, and attached to a
backcharge the GC has issued. Nothing about the money moves — netting a
deduction against a pay application is still billing-lane work this schema
refuses to half-build — but the dated, photographed record of what was
actually wrong and whose fault it was is now on the same screen as the
deduction it is evidence against. `backcharges.prisma` had no reference to
a punch item or to media at all.

**`isDone` is now derived from `status` by a trigger**, and this is the
part worth arguing with. CLAUDE.md says derived state is never stored and
the honest version of this change drops the column. It stays because
closeout readiness, the export, the Ask commands and the phone all read it,
and a destructive migration against real data to save two columns is not a
trade to make unannounced. The trigger buys back the property the rule is
actually about: nothing app-side writes them, so they cannot disagree with
the state. Proved by writing `isDone: true` by hand against a real Postgres
and watching it come back false.

Closeout readiness counts exactly the items it counted before: `isDone`
stays true for READY_FOR_REVIEW, which is all the old checkbox ever meant.
Tightening it to VERIFIED is a real decision about when a job may close and
it belongs to whoever owns closeout, not to this PR.

**The phone could not close an item offline.** The toggle called the API
directly and threw when there was no signal — so the one thing a punch list
has to survive, a basement, was the one thing it did not. It is a queued
operation now, replayable without an idempotency key because setting a
status twice lands on the same row, and the row shows "syncing…" until the
server agrees. The phone can mark ready and send back; it cannot verify,
which is the same boundary the capability draws on the web.

An after-photo is asked for and not required — Diego's call. A crew in a
stairwell with no signal and a GC waiting is exactly who a hard block would
punish, so the prompt says what is missing and links to the camera, which
attaches the photo to that item at the shutter.

Two things the database refuses outright, both tested against a real
Postgres: a state with no witness for it (READY_FOR_REVIEW with no
`readyAt`, VERIFIED with no `verifiedAt`), and two answers to who is fixing
it. The migration's backfill sends every ticked-off item to
READY_FOR_REVIEW rather than VERIFIED — that is tested too, by switching
the trigger off, writing the old shape, and running the migration's own
UPDATE against it, because a backfill runs once and can never be re-run.
