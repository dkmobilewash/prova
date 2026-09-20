### An audit of the estimating tool: what is built, what is not, and the one number the product does not hold (Diego)
`claude/trusting-wright-3dzxla`

**Docs-only, under the audit exception in CLAUDE.md's working agreement**
(granted 2026-09-07). It ships alone because it is documentation being
dragged back to the code, with no accompanying change to ride along with.

Ordered before deciding what to build next in estimating. `ESTIMATING-AUDIT.md`
maps every estimating surface in the app to the file that implements it, then
records eleven gaps, each one a grep that comes back empty across `apps/` and
`packages/` rather than an impression.

**The finding worth the audit: there is no markup, margin, overhead or profit
anywhere in the codebase.** `markup`, `marginPercent`, `overheadPercent`,
`profitPercent` and `contingency` appear only as CSS margins and as the word
"contingency" inside a comment. An estimate is `unitPrice × quantity` with
`budgetedUnitCost` beside it, so the estimator does the O&P arithmetic
off-screen and types the result in. `lib/wip.ts` computes gross profit after
the fact, from actuals. For a sub bidding 6-10 jobs a month, the number that
decides whether a bid makes money is the one number C Stream does not hold.

Three more that shape what to build:

- **A takeoff cannot be revised.** There is no takeoff model — the dimensions,
  waste, spacing and openings are discarded once `addTakeoffLineItems` creates
  the rows, and those rows carry description, unit and quantity only: no price,
  no cost, no trade, no craft, no phase code, no catalog link. Change a wall
  height and you get a second set of lines beside the first.
- **A bid invitation is never linked to its estimate.** `BidInvitation` has no
  `jobId` and `estimating.prisma` says so outright, so a typed `bidAmount` and
  the estimate's own total can disagree with nothing to reconcile them.
- **Nothing chases a bid due date.** `Job.bidDueDate` is read in exactly one
  place — `JobBidDetails.tsx` prints it. No alert kind, no badge, no sort. Yet
  `BidPursuit.expectedBidDate` DOES drive "coming up" and "passed with no
  invite" on `/pipeline`, so the pre-bid chase is watched and the actual bid
  is not.

**On FEATURE-AUDIT.md sheet 03, which reads "10 built · 0 partial · 0
missing".** Every one of those ten rows is genuinely built — each was checked
against the code and none is a false claim. But "0 missing" is a statement
about the original roadmap's row list, not about the product, and none of the
eleven gaps is a row on that sheet, so nothing can ever make it read otherwise.
The sheet also UNDER-states what shipped: its takeoff row credits
`JobLineItem.quantity` and does not mention `lib/takeoff.ts` or `TakeoffForm`
at all. Correcting the row list is separate work and should ride with whatever
gets built next, per rule 1.

**The limit of this audit is stated in its own first section rather than
buried.** No test was executed and no page was clicked: `pnpm install
--frozen-lockfile` cannot complete in this container because the egress proxy
answers 403 to `CONNECT cdn.sheetjs.com:443`, where `xlsx@0.20.3` is fetched
from. So this is a reading, which is weaker evidence than a run and weaker
again than a click. Nothing in it claims a feature WORKS — it claims a feature
EXISTS, with the line that implements it. The gaps are the strong half, since
"there is no model, no column, no action and no route for X" is a claim a grep
can settle.

It also re-surfaces `changelog.d/cyrus-catalog-labor-hours-meaning.md` rather
than rediscovering it: `defaultLaborHours` is still flat-vs-per-unit undecided,
`Decimal(8, 2)` still rounds 0.012 hrs/SF to 0.01, and one of the column's two
writers is still wrong today. It is listed as a blocker rather than a loose end
because until it is settled a specialty sub cannot keep crew production rates
in C Stream — which is where the risk in this trade lives, quantity takeoff
being ~97-98% accurate while projects overrun ~28%.
