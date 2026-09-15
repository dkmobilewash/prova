### The Ask box moves a job's schedule dates — phase 4b, the first command that rewrites a record to dates the person stated, with the card showing current and new and the tap refusing if the row moved (Diego)
`claude/prova-ai-task-completion-96pjes`

"Push Riverside's start to October 6", "Riverside now finishes November
20" and "move the Main St start back a week" now produce a card headed
"Reschedule the job" with five lines — the job and its GC, the CURRENT
start and end as stored on the row, and the NEW start and end — and a
button "Save the dates". The tap writes the two columns through a lifted
core, `lib/estimating/job-schedule.ts`, and the job page and `/schedule`
show the new dates afterwards.

**Why a lifted core and not the action.** `updateJobSchedule` throws its
one refusal ("End date can't be before the start date"), and production
redacts a thrown Server Action message, so `commands.coverage.test.ts`
refuses to register a DIRECT command over it. The phase-3 answer was to
lift the action's body into a plain function that returns its sentences
(`createInvoiceRecord`), and that is what `setJobScheduleDates` is. The
action keeps its throw for the form and now throws the SAME constant the
core returns, `END_BEFORE_START`, so the page and the card refuse a
backwards range in one voice. The action's operating-location field is
not touched by the core; the card does not offer it. The core lives in
`lib/estimating/` beside `create-job.ts` because that and `lib/billing/`
are the two directories the coverage test accepts a lifted core from.

**A modify is not a create, and the difference is the `expected` field.**
Every earlier DIRECT command inserted a row, or (the phase-2a T2s)
stamped today on a stay or closed an order. This one overwrites two
columns with values the person chose, on a row somebody may have edited on
the job page in the half hour between the card and the tap. So the
payload carries the dates the card was made from (`wasStartDate`,
`wasEndDate`), and the core's write is ONE `updateMany` whose WHERE names
them, nulls included — a compare-and-set that is atomic in Postgres where
a read-then-write is not. A row that moved matches nothing, writes
nothing, and comes back as a sentence naming what it holds now:
"Riverside Plaza's dates have changed since you last saw them — it now
runs Oct 6, 2026 to Nov 20, 2026. Ask again to see the current dates
before moving them." `lib/actions/ask.dbtest.ts` proves that against a
real Postgres: the first tap moves the dates, a second card made from the
old dates is refused with exactly that sentence and the row is unchanged.

**The model never supplies a date.** The schema takes the person's WORDS
for each date they mentioned — "October 6", "10/6", "next Monday", "a
week later", "back a week" — and `lib/ask/dates.ts` decides what they
mean against `ctx.today`, the person's own calendar day. Every accepted
phrase is pinned in `dates.test.ts` against fixed todays (a Friday, a
Monday, a Sunday in December), with the weekdays worked out by hand from
1 January 2026 being a Thursday rather than derived from the code under
test. Four kinds of answer, because a date phrase is not always a day:

- a calendar day (ISO, US `m/d[/yy]`, month-name forms either way round
  with ordinals and optional year, today, tomorrow, a weekday as the first
  one strictly after today, "in N days/weeks" from today);
- a shift from the date ALREADY ON THE ROW with the direction known ("a
  week later", "three days earlier", "out a week");
- a shift whose direction English does not settle — "back a week" means
  a week earlier to some people and a postponement to others, and a bare
  "a week" says nothing — which becomes a CHIP ROW: "Earlier: Sep 24, 2026
  (Thursday)" / "Later: Oct 8, 2026 (Thursday)", both counted from the
  stored date;
- a month-day with no year that has ALREADY PASSED this year, which is
  either a correction of the recent past or next year's plan, and is also
  a chip row: "Sep 1, 2026 (Tuesday) · 10 days ago" / "Sep 1, 2027
  (Wednesday) · in 355 days". A month-day still ahead this year is taken
  as this year, the one reading nobody disputes.

The chips ride the continuation path phase 1 built for "which job?":
their values are ISO dates on the `startDate`/`endDate` field, which the
parser reads unambiguously on the re-run, and no model pass happens in
between. Everything else — "in a month" (Oct 31 plus a month has no agreed
answer), "next week", "this Monday", "sometime next month", a day-first
"13/6", February 30 — is `null`, and the command asks for the date as a
calendar day, quoting the words it could not read. Not supported is not a
gap; it is the rule.

**Two refusals before a card exists, and one warning.** A date the row
already holds is said and not carded — "Riverside Plaza's start date is
already Oct 6, 2026 (Tuesday). Nothing to change." — because a button that
changes nothing is worse than none. A new range that ends before it starts
is refused in the action's own words. And when one of two named dates is
already on the row, the card carries a warning that only the other
changes. A relative phrase against a job with no date on record is a
question ("the end date itself — Riverside Plaza has no end date on record
to move 'a week later' from"), never a guess about where to count from.

**Dates on the card are UTC, with the weekday beside them.** Every date
line goes through `formatCalendarDate` (#242) and adds the weekday from
`getUTCDay()` — "Oct 6, 2026 (Tuesday)" — because a start on a Saturday
is worth seeing before the tap, and because it makes the weekday-phrase
reading ("next Monday" said on a Friday is three days away, said on a
Monday is seven) visible on the card rather than trusted.

**Capability and revalidation.** Offered on `MANAGE_JOBS` — the
capability whose own doc comment reads "jobs themselves" — so ACCOUNTING
and PAYROLL_COMPLIANCE are not offered it, though the job page stays open
and they can still edit the dates by hand there; `updateJobSchedule` has
no capability guard and this does not add one. `confirmAskProposal`
refuses a member without it in a returned sentence before anything is
claimed, and the db test runs an ACCOUNTING member at a real card to prove
it. `Executed` gains an optional `revalidate: string[]` so a command can
name what the action it stands in for would have revalidated —
`/schedule` here — rather than the confirm action hardcoding paths per
command.

**What the tests pin.** `dates.test.ts`: 23 spellings of October 6, the
which-year and either-way branches, every weekday and "in N" case, and 23
refusals. `commands/schedule.test.ts` runs `resolve` against a fake
Prisma: the questions before any read, the chip rows with their exact
values and details, the no-op and backwards refusals with their sentences
and links, the five preview lines and the exact payload, a chip's ISO
answer re-asserted in-company, and on `execute` the exact arguments the
core receives including `expected`. `estimating/job-schedule.test.ts`
pins the shape of the one UPDATE. `commands.test.ts` pins the whole T2
tier by name, FIELD and ESTIMATOR gaining `reschedule_job`, ACCOUNTING
not. `commands.coverage.test.ts` sees `updateJobSchedule` leave the
estimating exclusions for a registration. The eval gains four
`reschedule_job` cases (start, end, "back a week", a FIELD member with
"next Monday") and one `no_command` for ACCOUNTING; CI checks only that
they match the registry.

**Not clicked, and what the eval has not measured.** Nobody has loaded a
page with this on it. The routing eval was not run from here (no key in
this container), so whether the model puts "October 6" in `startDate` as
words rather than computing an ISO date is asserted by the schema
description and the eval case, not yet observed. The click list, on a
preview signed in as OWNER on the Development Clerk instance (the demo
database — if it has no job with dates, set start 2026-10-01 and end
2026-11-13 on one job's Schedule form first and use that job's name below
in place of "Riverside"):

1. `/schedule` → note the job's dates as shown, e.g. "Oct 1, 2026 – Nov
   13, 2026", and open `/jobs/<id>` to confirm the Schedule form's inputs
   read 2026-10-01 and 2026-11-13.
2. Dashboard → ask "push Riverside's start to October 6".
3. Expect a card headed "Reschedule the job" with exactly: Job "Riverside
   Plaza · <its GC>", Current start "Oct 1, 2026 (Thursday)", New start
   "Oct 6, 2026 (Tuesday)", Current end "Nov 13, 2026 (Friday)", New end
   "unchanged", and a button "Save the dates". A Current line that differs
   from step 1 is a failure. A New start other than Oct 6, 2026 is a
   failure. No card, or a card with no button, is a failure.
4. Tap it. Expect "Riverside Plaza now starts Oct 6, 2026 (Tuesday) and
   ends Nov 13, 2026 (Friday)." with a link "Riverside Plaza". Open
   `/jobs/<id>`: Start date input reads 2026-10-06, End date still
   2026-11-13, Operating location unchanged. `/schedule` reads "Oct 6,
   2026 – Nov 13, 2026".
5. Ask the same question again. Expect NO card and the sentence
   "Riverside Plaza's start date is already Oct 6, 2026 (Tuesday). Nothing
   to change." Any card is a failure.
6. Ask "Riverside now finishes sometime next month". Expect NO card and a
   question asking for the end date as a calendar day, quoting "sometime
   next month". Any card, or any date it picked for you, is a failure.
7. Ask "move Riverside's start back a week". Expect a chip row asking
   '"back a week" from Riverside Plaza's start of Oct 6, 2026 (Tuesday) —
   which way?' with two chips, "Earlier: Sep 29, 2026 (Tuesday)" and
   "Later: Oct 13, 2026 (Tuesday)". Tap "Later". Expect a card with New
   start "Oct 13, 2026 (Tuesday)"; tap Save the dates; the job page reads
   2026-10-13.
8. Ask "Riverside starts September 1". Expect a chip row '"September 1"
   has already passed this year — which start date?' with "Sep 1, 2026
   (Tuesday)" (detail "N days ago") and "Sep 1, 2027 (Wednesday)" (detail
   "in N days"). Do not tap either; ask something else.
9. The stale check, two tabs. Tab A: ask "Riverside now finishes December
   18" and STOP at the card (New end "Dec 18, 2026 (Friday)"). Tab B: on
   `/jobs/<id>` set End date to 2026-12-04 and save the Schedule form.
   Back in tab A, tap "Save the dates". Expect the refusal "Riverside
   Plaza's dates have changed since you last saw them — it now runs Oct 13,
   2026 to Dec 4, 2026. Ask again to see the current dates before moving
   them." and `/jobs/<id>` still reading 2026-12-04. An end date of
   2026-12-18 on the job page is a failure — it means the tap overwrote
   somebody else's edit.
10. Ask "Riverside now finishes October 1". Expect NO card and "End date
    can't be before the start date: Riverside Plaza would start Oct 13,
    2026 (Tuesday) and end Oct 1, 2026 (Thursday)."
11. In a browser signed in as a MEMBER with job function ACCOUNTING, ask
    step 2's question. Expect no card and a sentence that it needs job
    correspondence access (MANAGE_JOBS).
