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

**`isDone` and `completedAt` are gone.** They were a stored derivation —
`isDone` was `status <> OPEN` and `completedAt` was `readyAt` under another
name — and CLAUDE.md's oldest rule is that derived state is never stored,
because a stored flag can disagree with what it was derived from. These
could: nothing stopped a writer setting one without touching the other.

The first version of this change kept both columns and added a trigger to
hold them in lockstep with the status. That was the cautious answer rather
than the honest one: it left two columns whose only job was to agree with a
third, and every future reader still had to be told which one to trust.
Dropped instead, on Diego's call, announced in `#prova-build` before the
push and pushed past `preflight.sh`'s destructive-statement check
deliberately rather than quietly.

Everything that read `isDone: false` reads `status: "OPEN"`, which is the
same set of rows: closeout readiness, the Ask handlers and command, the
export, the phone, the demo seed. Two CHECK constraints replace what the
trigger was for — a READY_FOR_REVIEW row must carry `readyAt` and a
VERIFIED row must carry `verifiedAt` — so a state can never exist without
the stamp that dates it, which is also what makes `completedAt`
unnecessary rather than merely redundant.

**Order is load-bearing in that migration, and Prisma's own diff got it
wrong.** It put the two DROPs in the same statement as the ADDs and ahead
of them, which would have thrown `isDone` away before the backfill could
read it — silently reopening every closed punch item in the database. The
halves are separated by hand: add, backfill, constrain, then drop.

Closeout readiness counts exactly the items it counted before: it blocked
on `isDone: false` and now blocks on `status: "OPEN"`, the same set.
Whether an item waiting on a VERIFICATION should also block a closeout
package is a real decision about when a job may close, and it belongs to
whoever owns closeout — asked in `#prova-build` rather than answered here.

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
it. The backfill sends every ticked-off item to READY_FOR_REVIEW and never
to VERIFIED — the old checkbox never meant anybody had checked it — and
that is tested against a scratch table holding the old shape, because a
backfill runs once and can never be re-run. So is the drop itself: a column
the app has stopped writing and a column that is gone look identical from
TypeScript, and only one of them stops the next reader finding a stale
boolean nobody maintains.
