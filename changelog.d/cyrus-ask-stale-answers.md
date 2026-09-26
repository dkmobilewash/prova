### The assistant stops answering from a dead column, and stops refusing three things it can do (Cyrus)
`cyrus/ask-stale-answers`

Four defects in the Ask surface, all the same shape: a sentence or a query
that was true when it was written and is not true now. Three of them were
answers the box got wrong; one of them was a row it wrote into a column
nothing reads.

**1. Delays were read from a column the schema marks SUPERSEDED.**
`operations.prisma` says `DailyFieldReport.delays` was replaced on
2026-09-18 by `DelayEvent` — one row per delay with a cause, a responsible
party, times, crew-hours lost and whether the GC was told. `daily_field_reports`
still read the old free-text box, and `DelayEvent` appeared nowhere under
`lib/ask/` at all. So the assistant reported delays written up before the
changeover and a confident **zero** for every structured delay since, on the
one question a delay claim against a GC is assembled from — while its own
description promised that "reports WITH a delay are flagged". Typecheck, lint
and every test were green throughout, because reading a column that still
exists is not an error.

It now reads the delay log, labelled with the same helpers the job's Field
reports tab renders `<DelayLog>` from, and carries the legacy text beside it
as `legacyDelayNote` rather than merged into it — that note has no cause, no
party and no hours, and merging it would invent a delay that looks measured.
A delay needs no report (`logDelay` writes one against a job and a date), so a
day whose delays were logged with nothing written up is now a row of its own
rather than dropped. `crewHoursLost` and `delaysTheGcWasNotTold` are computed
here, because notice is what makes a delay claimable.

The obvious shape for that result — `{ reports, delaysWithNoReportFiled }` —
silently defeats the row cap: `forModel` caps an array or an object with a
`rows` key, and that is neither. It is one flat list of DAYS, which the cap
already handles.

**2. `log_daily_field_report` was the last writer of that dead column.**
`lib/field-reports-core.ts` says "no screen sends it any more", and the Ask
command still did — so a delay somebody mentioned to the assistant became a
row in a superseded column, with no cause, no party, no hours and no GC
notice, looking like pre-changeover data forever. The field is gone from the
card, and the description now says plainly that a delay is logged on the job's
Field reports tab. Deliberately not replaced with a delay card: `parseDelay`
requires a cause and a responsible party, and those are two judgements about
who is at fault rather than two fields to guess from a sentence.

**3. `KNOWN_GAPS` told the model to refuse a vendor's price change.** That
list is pasted into the system prompt, so a stale entry there is not a stale
comment — it is a standing instruction to refuse. `priceMovement()`
(`components/vendorPricing.ts`) has computed the change between a vendor's
last two quotes since /vendors/pricing was built, and that page renders it
under "Movement". `job_margin` carried the matching false sentence, "there is
no vendor price history". Both gone; `vendor_pricing` returns the figure —
same vendor, same unit, grouped by catalog item exactly as the page groups, so
the box and the screen cannot disagree. The model is handed `changePercent`
and a `direction` rather than two prices and a subtraction, because rule 1 in
`tools.ts` is that it never does arithmetic.

One deliberate difference from the page: a ZERO movement is kept. The page has
nothing to show for a price that did not move; "they quoted the same $7.85 in
May and again in September" is a real answer to "has their price gone up", and
returning nothing there reads as "we don't track that".

**4. `certified_payroll` refused what `needs_attention` reports.** It said it
"does NOT and CANNOT say whether a week was FILED: nothing in this app records
a payroll submission". The second half is true. The first was not —
`lib/alerts-query.ts` reads `ComplianceDocument` rows of type
`CERTIFIED_PAYROLL` and their periods to raise the alert the bell shows. So one
tool in the box refused what another tool in the same box reports.

These are two facts and they are now two fields. `documentOnRecord` says a
certified payroll is filed here against a period that CONTAINS the week —
same rows and the same containment as the alert, through one shared predicate
(`certifiedPayrollWeekIsCovered`, lifted out of `alerts-query.ts`) so the two
cannot drift. `submissionToAnAgency` says on every row that nothing records a
send or a receipt. The tool is told to say "a certified payroll is on record
for that week" and never "it was filed" — a document somebody put here is not
a receipt from anybody, and `false` means nothing is recorded HERE rather than
that nobody filed. A period that merely clips a week does not cover it.

Two smaller corrections found while looking, both the same class: the
"driving directions or travel time" gap argued from "job addresses are not
modelled as coordinates" (they are — `Job.siteLatitude`/`siteLongitude`, for a
daily report's weather), and `crew_assignments` ended "addresses… none of those
are recorded" when `Job.siteAddress` is. Both conclusions were right and both
arguments were false, which is the version a model repeats to somebody looking
at the address on the job page.

**The checks.** `supersededFieldCensus.test.ts` fails the build when an Ask
source reads a field the schema marks SUPERSEDED without also reading the model
the comment names as its replacement, and when anything under `lib/ask/` WRITES
one. It pins its size against a count of the literal `SUPERSEDED` that shares
no pattern with the parser, pins its scope by name, strips comments (this repo
has had a census disarmed by a comment quoting its own pattern), and drives
both matchers over fixtures so a matcher that matched nothing would fail rather
than pass everything. `staleClaimCensus.test.ts` checks every tool description
and every gap reason against the CODE that makes it false, and asserts each
source is the file it thinks it is first — a claim judged against the wrong
file is judged against nothing.

Mutation-tested, fifteen mutations, each confirmed applied before its result
was read: reverting each of the four fixes goes red naming it; so does
reinstating each of the four false sentences, restoring the gap entry,
loosening the week containment to an overlap, grouping quotes by wording
instead of catalog item, pairing them across vendors, dropping the unit check
inside `priceMovement`, breaking the schema parser, pointing either census at
a directory or a file that is not the subject, and disabling comment
stripping. One mutation SURVIVED first time and is why a fixture changed: the
job scope on the delay read was not load-bearing, because the date bound
happened to exclude the same row. A fixture whose two filters exclude the same
row cannot tell you which one is working.
