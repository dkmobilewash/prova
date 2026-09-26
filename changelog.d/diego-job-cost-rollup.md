### The WIP schedule was already built. You just could not look at it (Diego)
`diego/job-cost-rollup`

FEATURE-AUDIT said "no cross-job/company-wide roll-up view", and the
obvious reading was that company-wide job costing needed building. It did
not. `lib/wip-schedule.ts` already had the whole thing — nineteen columns,
per-job contract value against cost to date against estimated cost at
completion, earned revenue, over- and under-billing, backlog, three
coverage ratios, and a totals line — all pure, all unit-tested, and
`loadWipSchedule` already assembling it.

**The only thing that rendered any of it was a CSV download link on
`/cash-flow`.** A contractor could hand this schedule to a surety and
never see it themselves.

So `/wip` invents no numbers. Same query, same rows, same order, and the
download stays exactly where it was. The gap was a screen.

## What the screen has to get right, and it is one thing

`wipScheduleRow` returns **null** for a figure when under 80% of the job's
value carries the estimate it depends on — the number would describe
missing data rather than the job. The CSV says so in a preamble and leaves
the cell empty, which a spreadsheet can carry.

A screen cannot. `$0.00` in a gross-profit column reads as a job that
broke even. An empty cell reads as nothing at all. "We cannot say yet" is
the truth. **Three different facts, one of them true, and an owner
deciding what to chase cannot tell them apart by looking.**

`lib/wip-schedule-cell.ts` is therefore pure and the formatting lives
there rather than in the page: this is the entire correctness of the
feature and everything else on it is layout. A nullable column renders an
em dash **and** carries its reason, in one return value, so the mark
cannot be rendered bare. The same sentence is printed above the table —
a blank that means "we cannot say" is worthless if the explanation only
exists in the download.

| mutation | result |
| --- | --- |
| render null as `$0.00` | RED, 2 failed |
| render null as blank | RED, 3 failed |
| drop the reason from the mark | RED |
| format a ratio column as money | RED |
| render zero unpriced hours as a dash | RED |

That last one is the opposite error and worth its own case: **zero
unpriced hours is a fact** — every hour on the job carries a burdened
cost — unlike the silenced money cells. A dash there would invent a
coverage problem that does not exist.

## One wide table, not a phone layout

Nineteen financial columns do not fit 375px. The obvious answer is a card
per job showing the important six, and it was rejected: picking six
invents a SECOND definition of this schedule that quietly disagrees with
the CSV a surety is reading. A WIP schedule is wide because the document
is wide. The table scrolls sideways inside its own container — so the
PAGE never overflows, which is what the phone-width checks measure — and
the job column is sticky so a row stays readable while it scrolls.

## What the guards made better

The nav censuses refused three things and each improved the page:

- **an empty branch that was not `EmptyState`.** Hand-rolled, so it said
  nothing about what the page is for. It now explains the document and
  offers two ways out.
- **a nav route with no walkthrough.** `/wip` is a customer page, so an
  exception line would have been the wrong answer. It has five steps, in
  the plain words the other walkthroughs use.
- **a walkthrough step pointing at nothing.** I wrote a step explaining
  over- and under-billing with no anchor to hang it on. Rather than delete
  the step — that pairing is the most-misread thing on the page, because
  "overbilled" sounds like good news and is a liability — the page gained
  a two-line legend under the table. The census turned a broken tour step
  into a thing the screen says out loud.

## An audit row that was already wrong

"Job profitability report — still no dedicated exportable report" is
marked Built here, and **not because of this PR.** The WIP schedule CSV
already carried contract value, cost to date, estimated cost at
completion, estimated gross profit and gross profit earned: that is budget
vs. actual vs. forecast margin, exportable, and it has been for a while.
The row was stale before `/wip` existed. Corrected rather than claimed —
the screen is new, the report was not.

`VIEW_COMPANY_FINANCIALS`, matching the CSV route rather than something
stricter, and its own comment is the argument: gating a screen harder than
the file of the same figures would be theatre.

No migration. 7,845 unit tests, typecheck and lint clean. **Nobody has
clicked it.**
