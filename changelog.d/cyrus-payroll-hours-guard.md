### A logged hour can be corrected now, and it can't be deleted by accident (Cyrus)
`cyrus/payroll-hours-guard`

Issue #63. A field time entry on `/jobs/[id]` had exactly one control —
**Remove** — and it deleted on the first click, with no confirmation. So the
only way to fix "10 hours" that should have been "8" was to destroy the row and
type a new one. These are the rows a WH-347 is built from, and #61's sibling
finding already has the app comparing entered hours against a prevailing-wage
rule set ("entered 10 straight, rules imply 8 straight, 2 OT") — a comparison
that presumes the entered figure is a record rather than a draft. Separately
the two findings read as UX nits; together they meant the app's
highest-consequence rows were the only ones with no audit trail and no guard.

**Remove now asks twice**, through the shared `<ConfirmDelete>` rather than a
fourth hand-rolled copy — so arming it hides *every* other action in the row
(including Edit, and including whatever gets added there next), and Cancel
takes the pixel Remove vacated: `pinned="end"` on the desktop because the
cluster is right-pinned, and the full-width column with Cancel on top below
640px, which the component does itself.

**Edit opens the same `<TimeEntryFields>` the log form uses**, with one
difference that is the whole safety property: the person and the day worked
render as TEXT, not as inputs. A correction changes the FIGURES — hours, pay
type, note, per diem, travel pay, cost code, craft classification. It never
changes whose day it was or which day it was, because those (with the job and
the crew member) are what a WH-347 line is keyed by: change one and the row is
not a corrected record of Tuesday, it is a record of somebody else's Wednesday.
Re-attributing an hour is still a delete and a re-entry — which now takes two
clicks.

**The lock is in the database, which is the part worth reading.**
`20260905183000_add_crew_members` deliberately did NOT ship a BEFORE UPDATE
trigger on `TimeEntry`, and wrote down why: it is a live payroll table, the
model shipped unwired, and an unclicked trigger would have met real rows first.
`timeEntryWriteCensus.test.ts` held the line instead by asserting that NO
update path existed anywhere — and it went red, exactly as designed, the moment
this branch added one. Its own message says what to do about that
("put the lock back in the database… do not add a check in the action and call
it done"), and that is what happened: `prova_time_entry_identity_lock` RAISES
on any UPDATE that changes `jobId`, `employeeUserId` or `date`, or that repoints
a `crewMemberId` that is already set. The reason the trigger is acceptable now
and was not then is the reason that migration gave: there is a form that
exercises it, and a click-list that saves a correction through it.

The census changed shape rather than being disarmed — no `EXCEPTIONS` entry. It
now asserts that every `timeEntry.update` builds its payload with
`timeEntryCorrectionUpdateData()`, whose key set is asserted EXACTLY (not as a
subset — a subset check passes just as happily with `date` in it), that no
`updateMany`/`upsert`/nested relation write exists, and — new — it carries
PLANTED OFFENDERS through the real check so "found nothing" is distinguishable
from "can find nothing", plus a size assertion that the one update path is
still there to be scanned. A second test reads the migration SQL and fails if
the trigger stops naming every column the code calls locked, counting the
comparisons so a trigger that mentions a column only in its error message
cannot pass.

**What this does not do**, stated because the issue asked for more: the row now
says *"corrected Sep 13 by <name>"* — that a correction happened, when, and by
whom — and it does not record what the figure used to be. The amendment row for
that (a locked original with a correction beside it, the way
`SubmittalRevision` handles a package going again) is a follow-up, not an
oversight: every read path — WH-347, certified payroll, the apprentice ratio,
burdened cost, the job page totals — would have to learn to ignore a superseded
row, and one that missed the memo would DOUBLE the hours on a signed filing.
Half of that model is worse than none of it.

Three things came along because they were in the way. The pay-type label list
existed in three copies (page, form, action) and is now one. `logTimeEntry`
threw "Hours must be a positive number", which production redacts to a digest —
it returns the sentence now, from the same parser the correction uses, so the
two forms cannot validate the same field names differently. And all three write
paths revalidated only `/jobs/[id]`, leaving the certified payroll report and
the WH-347 stale: a corrected hour that still reads 10 on the report a GC gets
is the same defect as one that still reads 10 on the job page.

Mutation-tested in both directions rather than asserted: `date` added to the
update payload turns the exact-key-set test red; dropping `locked` from the edit
form makes it render a date input and the row test names it; inlining the update
payload in the action turns the census red; deleting one comparison from the
trigger SQL turns the migration cross-check red; and dropping `pinned="end"`
turns both the row's order test and the rowActions census red.

**The migration is UNVERIFIED against Postgres** — this session had no database
it was allowed to touch, so the plpgsql is a near-copy of the CrewMember
identity lock that has run on production since 5 September rather than something
executed here. It is additive and can only refuse a write; it cannot rewrite a
row. It needs the Slack announcement before the push (working agreement rule 4),
and the demo database needs the **Migrate demo database** workflow before a
preview will render the new columns.
