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
priced work split by cost code and not by apprentice tier. Neither form calls itself
ready while anything is blocking, because the guidance on the DAS 140 says
"TBD", "N/A" or a blank invalidates the form outright.

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

---

**Six defects an adversarial review of this PR found, fixed on the same
branch before it merged.** Each one is a test that fails with the defect put
back, and each was mutation-tested rather than argued about.

**The dangerous one first: two screens disagreed about whether a committee
could be sent to, and the print view was the one that was wrong.** The
printed form tested the JOINED address — and joining `[null, null, "Fresno",
null]` returns `"Fresno"`, a perfectly non-null string. So a committee with
no street line, no email and no fax printed on a DAS 140 as though its
address were complete, with no red sentence anywhere, while the directory on
`/union-compliance` called that same row undeliverable in the same session.
A box that LOOKS filled in on a document the state receives is worse than an
empty one — nobody re-checks a filled box, and there is a documented penalty
for sending a 142 to the wrong committee. `committeeDeliverability` in
`das-forms.ts` is now the ONE function that answers it, used by the print
builder and by the directory, and it says what deliverable means: post needs
a street line, a city and a state or a ZIP; email or fax alone is enough,
because 8 CCR 230.1 names all three; a field holding only spaces is empty. A
partial address is never printed in the address box — `addressGap` names
what is missing and what IS on file, so "half an address" and "no address"
stay two different sentences. A census walks every file in `apps/web` that
mentions a committee and fails if any of them derives this from the raw
fields again, and the census asserts its own scope contains the two files
that disagreed, because a walk that finds nothing passes everything after
it.

**The proposals matched crafts by NAME while an ID for the join sat unused.**
A committee's `craftName` is the craft in the committee's words
("Drywall/Lathers"); a `CraftClassification.name` is the craft in the
company's ("Drywall"). `das-forms.prisma` says outright that those routinely
differ and adds `craftClassificationId` for exactly this — and nothing used
it. So `DAS140_MISSING` never cleared however many notices went out, and the
suggestion told the contractor to add a committee that was already in the
directory. The join is the link now, on both sides — craft → committee →
notice — and there is deliberately no name fallback, because a fallback here
is the bug wearing a safety net. A committee with no link gets a proposal
saying so, which is a thing one click fixes.

**And a seventh thing the review did not see, which only a real database
showed.** `CraftClassification` is unique on `(unionLocalId, name)`, so a
trade's journeyman tier and its apprentice tier are two SEPARATE
classification rows — and `ApprenticeshipCommittee.craftClassificationId` is
a single FK, so one committee row links to exactly one of them. Matching a
craft on the classification exactly would therefore have raised "no committee
is linked to this craft" on the apprentice-tier row of every trade, forever:
the directory refuses a duplicate committee, so there is nothing to click.
Worse, the dispatch proposal counted apprentice hours per classification,
where a journeyman row reads zero apprentice hours on every job by
construction — a DAS 142 proposed on a craft that already has apprentices on
it, permanently. So a craft is matched to a committee by the UNION LOCAL of
the classification the committee is linked to, and the journeyman/apprentice
hours are counted over that local. The local is the only id this app holds
for "the trade", and it is what `apprentice-ratio.ts` already groups a ratio
by. The cost is written down rather than hidden: a company running two
genuinely different trades under ONE local gets one committee's link covering
both, so a notice missing for the second trade is not proposed. A quieter
engine, not a wrong claim — nothing here ever says a job owes nothing.
`das-query.dbtest.ts` is new and covers that seam against a real Postgres:
two locals' same-named classifications stay apart, the apprentice tier lands
under its trade, and the untagged hours produce no committee proposal at all.

**Several committees covering one craft collapsed into one.** The notices
were keyed on the craft, so one notice suppressed the proposal for every
committee on that craft, and of two notices only the last one written to the
map was ever examined for "never sent". Keyed on the committee now.
`approvedToTrainUs` — which the schema says decides how many notices an
award owes — was never passed in at all; it is now, and what it produces is
NOT a count. Whether one notice to a signatory's own JATC discharges the
craft is `das140-recipients`, `verified: false`, a question nobody has put to
counsel. So each committee with nothing on file gets an OBSERVATION naming
it and its approval state, all three values said out loud, and when two
committees cover a craft and one's approval is blank,
`DAS140_RECIPIENTS_UNKNOWN` says the count cannot be worked out and why,
rather than picking a branch.

**A notice sitting unsent raised nothing until somebody logged an hour.**
The 140 proposals were derived inside the loop over crafts that already had
hours — and the ten days the notice has to go out in is usually over before
anybody works. The notices are walked in their own loop now, the shape the
142 side already had.

**One untagged timesheet hour produced a permanent, un-clearable item.** The
untagged-hours pseudo-row went into the engine as though it were a craft, so
any job with an hour nobody had tagged showed "Add the apprenticeship
committee for this craft and area first" forever — no committee can ever be
linked to "no craft tag". It is recognised by its null classification rather
than by its label, owes nothing to anybody, and the real fact underneath it
survives as `HOURS_WITHOUT_CRAFT`: how many hours are untagged, and that
tagging them clears it.

**Changing a committee's classification on the row edit reported success and
changed nothing.** The shared field set renders that select on the edit form
and `updateApprenticeshipCommittee` never wrote the column, so a link set by
mistake could not be removed either. Writable and clearable now, validated
as one of this company's — and a test walks every other field the shared
form submits, so the next omission of this shape fails instead of shipping.

**And a field that could never be anything but `false` is gone.**
`Das140Form.sendable` / `Das142Form.sendable` were `blocking.length === 0`
while `signature` is pushed unconditionally and always will be: nothing here
signs anything. That is CLAUDE.md's "written, documented, and never called"
shape wearing a boolean, and the name read as permission to send. It is
`completeExceptSignature` now — true when the only thing left is the
signature — it VARIES, and both print pages branch on it: a form with a box
still blank stays red, and one that is genuinely finished says so in amber
and names the one thing C Stream will never do.
