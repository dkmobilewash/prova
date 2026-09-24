### DAS 140 and DAS 142 — the two forms that keep an apprentice ratio from going wrong in the first place (Cyrus)
`cyrus/das-forms`

Prova could already tell a California public-works contractor the exact day
its crew went over the apprentice ratio. That day is in the past. What it
could not do was hand them either of the two documents that stop the next
one — and there was not one mention of DAS 140 or DAS 142 anywhere in the
repository, while `apprentice-ratio.ts`, `apprenticeship.ts` and
`union-compliance-query.ts` already held the inputs.

**Two documents, two tables, and the reasons are in `das-forms.prisma`.** A
**DAS 140** notifies an apprenticeship committee that a contract was awarded
— once per award per craft, within ten days of execution and never later
than the first day anybody works. A **DAS 142** asks a committee to dispatch
an apprentice, and has to go out days before one is needed. They were
deliberately not modelled as one row with a type flag: the unique keys
differ (a 140 is one per craft; a 142 repeats per need-date), the deadline
arithmetic runs in opposite directions, the fields do not overlap, and only
the 142 has an outcome. A flag would have made every one of those a runtime
branch on a column.

**The deadline this app refuses to state exactly, and why that is the
feature.** The 72-hour rule excludes holidays and is counted to the hour.
Prova stores calendar days at UTC midnight and holds no California holiday
calendar — and is not inventing one, because a hardcoded list of state
holidays rots silently on the one screen that says a deadline was met. So
`latestSendDayIgnoringHolidays` counts back three days skipping weekends,
its name says what it ignores, every status it feeds reads `BY_DAY`, and the
two things it cannot see are carried as DATA on the standing
(`DAS142_LEAD_TIME_CAVEATS`) so no screen can render the date without them.
A holiday can only make the real deadline EARLIER, which is the asymmetry
that makes the approximation safe at all: "this is already late" is
trustworthy, "this looks in time" always arrives with what was not checked.

**Nothing about these rules has been read off a primary DIR page, and the
app says so on the screen.** Outbound HTTPS to `dir.ca.gov` is blocked from
this container — `WebFetch` returned `EGRESS_BLOCKED` for both the
requirements summary and the DAS 140 PDF — so every rule here came from
search-index-attributed guidance at one remove. `FEATURE-AUDIT.md` already
carries this exact failure once, for the prevailing-wage determination rule
(8 CCR 16000, "located by web search and **not yet clicked through to the
primary pages by a human**"), in a file no contractor opens. So
`DAS_CITATIONS` is a machine-readable table, every entry is
`verified: false` with the primary URL that would settle it and the question
to ask, `DAS_UNVERIFIED_FOR_COUNSEL` is DERIVED from it rather than written
twice, and `DasUnverifiedNote` puts the whole list on the job's Compliance
tab under a line that says nine rules are unconfirmed. `das-forms.test.ts`
fails the build if an entry claims `verified` without a `dir.ca.gov` URL.

**What Prova will not fabricate, which is most of the design.** There is no
committee registry and none is planned — DIR publishes one, and copying it
here would put a street address on a document the state receives, sourced
from a table nobody maintains. A committee is a row the contractor fills in
once from DIR's lookup (`ApprenticeshipCommittee`, on `/union-compliance`)
and reuses on every notice. Every contact field is nullable and a blank
prints as a blank with a sentence naming who fills it, the way the WH-347
page already prints its missing boxes in red. The printed forms also refuse
to print a licence number from the wrong state — a California public-works
form wants the California licence, and an Arizona number in that box looks
entirely filled in — and refuse to derive the contractor's estimate of
journeyman and apprentice hours from the estimate's labor lines, which are
priced work split by cost code and not by apprentice tier. Both `sendable`
flags are false while anything is blocking, because the guidance on the DAS
140 says "TBD", "N/A" or a blank invalidates the form outright.

**Proposed, never created.** `dasProposals` reads the job's own records —
public works, contracted, which crafts have hours — and says in words what
looks owed, naming the evidence: "184 journeyman hours and no apprentice
hours are logged on Drywall, and no dispatch request is on file for it." It
never writes a row, because a notice's whole purpose is to say a notice
exists and that is a thing a person asserts. It applies NO statutory ratio:
the commonly-stated 1:5 is in the citation table as a question for counsel,
and `apprentice-ratio.ts` already refuses to judge a day it cannot. And a
job whose `publicWorks` is NULL proposes nothing at all — "nobody recorded
it" is not "yes".

**No counter, and that is a decision.** WH-347 has a per-job payroll number
because the federal form has a "Payroll No." box. Neither DAS form has one,
so minting `DAS-140-0007` would print a number on a state document nobody
asked for. Nothing to register in `NUMBERED_TABLES`, nothing to add to
CLAUDE.md's roll-call.

**Evidence records, enforced where a person can reach them.** `craftName` is
snapshotted from the committee at creation and never joined back, so
renaming a committee cannot rewrite what a committee was told. Once sent,
only the note and the proof-of-transmission note change; the sent date is
recorded ONCE, because it is the whole of the ten-day and 72-hour tests; and
a sent notice cannot be deleted by anyone, owner included. The one thing
freely editable afterwards is the committee's REPLY on a 142 — that is our
record of somebody else's answer, not a claim we made to them — and
"nothing recorded" is kept apart from `NO_RESPONSE`, which means somebody
checked and is the record that shows you asked.

**Where it lives: nowhere new.** `navItems.tsx` already carries 39 items
across 7 groups and this adds none. The notices are on the job's Compliance
tab, beside the public-works facts they are filled in from — a DAS 140 is
about one contract award, and for a specialty-trade sub the award is the
job. The committee directory is on `/union-compliance`, beside the
apprentice ratio that makes somebody want it. The two print views are
sibling routes outside the tab group, exactly like
`certified-payroll/wh-347`, and take their width from `PageShell` rather
than a `max-w-*` of their own.

**The checks.** `20260926000000_add_das_forms` is purely additive —
generated with `--from-schema-datamodel`/`--to-schema-datamodel`, which
opens no connection at all (the 2026-09-18 shadow-database scar), three
`CREATE TYPE`, three `CREATE TABLE`, and `ALTER TABLE` only on the new
tables to add their own keys. `preflight.sh` names it and confirms "all
additive — no drops, truncates or deletes". Applied against a real Postgres
16: deleting a job while a DAS 140 exists is refused by
`Das140Notice_jobId_fkey` (the #227 shape, which is why both models are in
`HANDLED_MODELS` and in both cleanup scripts' `del()` order), and a second
notice for the same job, committee and craft collides on
`Das140Notice_jobId_committeeId_craftName_key`. Seventeen guards were
mutation-tested — the weekend skip, the first-worker bound, the null
public-works silence, the unverified citations, untiered hours counted as
journeyman, the caveats travelling with the date, an invented address, a
wrong-state licence, one of two hour estimates accepted, a sent notice
deleted, a sent date edited, a sent notice's substance rewritten, the
capability gate, the craft snapshot, a committee edit rewriting it,
approved-to-train defaulting to false, and `assertOwner` in place of
`ownerRefusal` — and all seventeen went red with the message naming the
defect, including `ownerRefusalCensus.test.ts` catching the last one.
