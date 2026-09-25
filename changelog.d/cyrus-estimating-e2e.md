### Thirteen estimating features now get clicked by a machine (Cyrus)
`cyrus/estimating-e2e`

Between 22 and 24 Sep, thirteen estimating and takeoff features merged —
#435, #460, #467, #470, #476, #491, #492, #494, #496, #499, #500, #502 —
and every one of their PR bodies ends with the same sentence: *"Nobody has
clicked it."* The pure arithmetic under them all has unit tests. Not one
SCREEN had coverage of any kind, and three query modules had none either.
So a page could render an error boundary, a form could refuse in silence,
and nothing in this repo would know — which is precisely the state the
whole `e2e/` directory was written to end after 2026-09-21.

Three new Playwright specs, on three new personas, in the shape
`journey.spec.ts` set:

- **`estimating-spine.spec.ts`** — the Estimate tab's five panels; wall
  types and a job's wall schedule turning one run into four derived lines;
  the bid recap's cost types, rates and apply; labor hours and a production
  rate saved and read back; an estimate template created on `/catalog` and
  applied; the proposal clause library and a job's proposal document; the
  job's gross area and the conceptual $/SF calculator.
- **`takeoff-plan.spec.ts`** — a real PDF opened by pdf.js, the scale set by
  two clicks and a typed dimension, a run traced, and the measured quantity
  arriving on the estimate as an unpriced line named after where it was
  measured. This is the one feature in the batch that cannot be checked any
  other way: the unit suite runs in happy-dom, where
  `getBoundingClientRect` returns zeros, so a tool that turns a click
  position into a fraction of a page width is invisible to it.
- **`bid-desk.spec.ts`** — the four panels #491/#492/#494/#496 stacked into
  one row of `/bids`: alternates, unit prices and allowances with what each
  does to the total; an unacknowledged addendum making the bid
  non-responsive and the acknowledgement clearing it; two quotes where the
  cheaper one leaves the soffits out; a won bid linked to the job it became.

**Every `expectHealthy` is passed its monitor.** A call without one never
looks at what the browser threw — the "absence of a failure is not a pass"
shape, wearing an assertion's clothes.

**No assertion here judges a money formula, deliberately.** What a markup
or a variance SHOULD come to is Diego's call, and a figure pinned by
something that cannot see the screen is worse than no figure. The money
assertions are arithmetic these files supplied themselves (1,000 SF at
$2.00 is $2,000 direct; $120,000 plus an accepted $12,400 alternate is
$132,400; $82,000 against $79,000 is a $3,000 spread) plus the structural
claim that applying a recap reached the database — the unit price read back
from the server is no longer the one that was typed. The exact totals are
on the click-list for a person.

**Geometry is asserted to the precision a mouse has.** A click lands on a
device pixel, so a fraction of a 300px-wide sheet carries about ±1/300;
40 ft is asserted within 1.5 ft and the sheet's 100 ft width within 3 ft.
What is asserted EXACTLY is that the figure the overlay read while the
shape was a draft is the figure the server re-derives from the stored
geometry afterwards — the round trip, not the rounding.

**Two `.dbtest.ts` files for the two query modules that had nothing**, and
both were mutation-tested rather than argued:

- `conceptual-estimate-query.dbtest.ts` — drop the `COMPLETE` filter and 4
  tests go red (a running job priced at $900/SF walks into the range); drop
  the `companyId` and the same 4 go red on another company's $500/SF work.
- `takeoff-currency-query.dbtest.ts` — reach bids by `companyId` instead of
  `wonJobId` and 2 go red; drop the `affectsPricedScope` filter and 1 does;
  drop `companyId` from the plan query and the tenancy test does. Same-day
  revisions must not supersede, and an undated addendum has to be REPORTED
  rather than dropped, because it cannot be placed in time either way.

`takeoff-plan-view.ts` was on that list of three and gets a **unit** test
instead, said out loud in the file: it opens no database and has nothing to
query — it is pure types plus the `TOOLS` constant. What is worth holding
there is the decision its own header records, THERE IS NO CEILING TOOL,
because a traced polygon has an area and not a length and a width. That was
a comment; it is a test now.

**One thing this branch got wrong, and the guard that caught it in
seconds.** The first draft of the specs wrote `[data-tour="…"]` selectors
literally. `walkthroughCensus.test.ts` counts every `data-tour` literal in
`apps/web` with `git grep` and requires the import walk from the app's own
pages to reach all of them — and a spec file is in no page's render graph,
so the count went 281 against 277 and the build went red naming the gap.
`e2e/lib/dataTour.ts` exists for exactly this and says so at length; the
specs now use it. The census's exclusion list covers `*.test.ts` and not
`*.spec.ts`, which is why nobody had hit it before — the existing specs all
went through the helper.

**One race these specs had, fixed before CI ever read them.** A dozen
assertions here read a value back after a reload, which is the right way to
prove a write landed — but `click()` resolves when the button is pressed, not
when the action answers, so `click(); await page.reload()` navigates out from
under an in-flight `fetch` and races the write it is about to check. That check
then fails, or worse passes, for a reason that has nothing to do with the
feature. `settleAction` in `e2e/lib/journey.ts` arms a response wait first and
returns when the server has answered; every read-back in these three specs goes
through it, and it takes a callback because half of them are a `<select>`'s
change rather than a press.

**What still has no coverage, stated rather than left to be assumed.** The
`/api/takeoff/plan/[planId]` route is stubbed in the browser by the takeoff
spec (the fake blob it would proxy does not exist in the suite), so its own
tenancy and capability checks are still unproven. The actual-vs-estimate
production back-check (#435) needs hours logged against a line and is not
driven. Neither is the wall schedule's "Refresh from wall types", the
takeoff area and count tools, a multi-sheet plan, or a SETTLED bid outcome
— that one needs a COMPLETE job with real costs on it.
