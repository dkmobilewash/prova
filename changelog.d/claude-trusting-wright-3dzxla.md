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

## Added 2026-09-20: `ESTIMATING-MARKET.md`, and the build order it moved

A browser survey of eight takeoff/estimating products — OST + Quick Bid,
STACK, Bluebeam Revu, PlanSwift, Togal.AI, Kreo, Procore Estimating, Sage
Estimating, plus shorter passes on Handoff.ai, Buildertrend and JobTread —
read through a wall-and-ceiling subcontractor's lens.

**Its first paragraph is the load-bearing one and says the file is
REPORTED, not verified.** Nobody here opened any of these products; it is a
browser session's reading of vendor help centres, release notes, review
sites and one university study, with that session's own evidence tiers (A =
help-centre page with UI screenshots, B = docs without screenshots or a
detailed independent report, C = marketing) preserved per claim, and its
NOT ESTABLISHED marks kept rather than smoothed over. Good enough to decide
a build order from, because a build order is a bet. Not good enough for a
product claim, a pitch, or a sentence about a competitor that somebody
outside this company reads. Recorded that way deliberately: this file's own
scars are mostly about a claim that was true when written being inherited
later as fact.

**The finding that reframed the question: every AI takeoff engine surveyed
detects the plan-view wall centerline and stops.** Wall height is in the
sections; wall type is in the partition schedule; no product joins them.
Five independent sources converge — Procore's own docs say Auto-Area "does
not support vertical wall areas", OST returns walls as linear segments only
and excludes Detail/Section/Elevation, and three separate users report the
AI ignoring varying ceiling heights, failing to tell a 2x4 from a 2x6, and
failing to differentiate wall or ceiling types. So AI takeoff returns
LENGTH, NOT AREA for our scope. The sharpest number in the corpus is about
our trade specifically: a Togal-vs-OST study's 76% time saving collapsed to
**22% on the one Reflected Ceiling Plan tested** — and acoustical ceiling
takeoff is RCP work.

**Three things moved in `ESTIMATING-AUDIT.md`'s build order, with the
reasons written into the section rather than left in the diff:**

- **`defaultLaborHours` went from last to first.** Every surveyed product
  that is an estimating tool rather than a measuring tool stores the rate
  PER UNIT — Sage as hours-per-unit or units-per-hour, Procore as
  `Quantity × Labor(hrs) × Difficulty`, Quick Bid as Qty/Hr-Day, STACK as a
  Coverage Rate. Not one stores a flat per-line figure, and two carry a
  separate adjustment factor (Sage's Productivity Adjustment, Procore's
  Difficulty) so height and access price without corrupting the base rate.
  `cyrus-catalog-labor-hours-meaning.md` asked which reading was right and
  said the evidence did not settle it; it does now, from outside, and
  `importCatalogEntries` is the writer that matches the market.
- **Inclusions and exclusions moved up.** Only Procore models them as
  structured objects. Quick Bid — the incumbent in our trade — has merge
  fields for alternates and unit prices and NONE for exclusions: static
  text retyped into a Word template. Five products have nothing. Widest
  open gap in the survey and the cheapest thing on the list.
- **Drawing measurement came off the list entirely**, which is a decision
  not to build rather than a reordering.

Markup now has four reference designs instead of none, and they share a
shape: an ORDERED STACK of typed adjustments per cost type, overhead
entering the cost base before profit, bond computed last on the marked-up
total, and markup-on-cost vs margin-on-price as an explicit per-bid setting
rather than an assumption nobody can see.

**What the survey could not answer is written down too**, so nobody assumes
it was covered: no vendor, reviewer or user anywhere publishes a
time-to-produce-one-bid figure, and shipped wall-and-ceiling assembly
content is NOT ESTABLISHED for every product that could plausibly have it —
which is the single most useful unanswered question for deciding how much
starter content a new account is owed.
