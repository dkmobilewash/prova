### Money Rail groundwork — the five pipeline figures, computed but not yet wired (Cyrus)
`cyrus/money-rail-groundwork`

The next UI direction turns the nav into a live money pipeline — Bidding,
Building, Proving, Staying legal, Getting paid — each stage carrying the
real figure for that stage of the business. This lands the DATA half only:
`lib/moneyRail.ts` (one loader, `getMoneyRailStages(companyId)`, plus a
pure `assembleMoneyRailStages` the tests exercise) and a presentational
`components/MoneyRail.tsx` that nothing renders yet. Deliberately not
wired into any layout: #249 owns `navItems.tsx`/`Sidebar.tsx` right now,
and integrating there before it merges would re-run the changelog-conflict
scar in a nav file.

Every stage REUSES the definition of the surface it will link to, so the
rail cannot disagree with the page behind it — the #46/#97 lesson applied
before the bug instead of after. Bidding is `isLive` from
lib/bid-pipeline.ts (INVITED or SUBMITTED), with the same
partial-sum flag as `valueWon`: unpriced live bids make the figure a
floor and the detail says so. Building is the CONTRACTED/IN_PROGRESS
population from company-financials-query with quantity × unitPrice
contract value. Proving is `Rfi.status = SENT` plus submittals whose
DERIVED state is WITH_GC — `submittalState`, never a stored status.
Staying legal is `renewalAlerts`' EXPIRED + DUE_SOON, per-kind horizons
intact. Getting paid is per-job max(contract − billed, 0) plus
`loadRetainageHeld` — THE retainage query, unfiltered, and this loader
never reads retainage columns off its active-job list, which is exactly
how #97 happened.

The specific check: `apps/web/lib/moneyRail.test.ts` pins the five keys in
pipeline order, the money/count typing of each figure, the floor flag, and
that the assembly does not clamp negative retainage (withheld − released
is signed on purpose). No dbtest, on the dbtest config's own instruction —
that suite runs against a scratch database only, and this branch's
configured database is real dev data.
