### C Stream Bid: the Estimates path is real — start an estimate, measure it, price it, set the markup, print the proposal, all inside Bid (Cyrus)
`feat/bid-estimates`

**Why.** The foundation (`feat/bid-foundation`) gave Bid its own host, shell and
nav and left Estimates, Price book and Settings as "coming in this build". The
whole pitch is one connected chain — drawings to proposal — so those three are
the product. This builds them, by RENDERING THE CRM'S OWN SCREENS with Bid's
links, not by copying them: a line priced in Bid is the line the CRM shows, the
recap marks up the same cost base, the wall type prices from the same price book.

**What a person can do now.**

- `/bid/estimates` — the jobs still being priced, GC, line count and bid total
  (`bidTotalOf`, the one sum the CRM header and the recap use). "Start an
  estimate" runs the CRM's own `NewJobForm` and `createJob`.
- `/bid/estimates/<id>` — a slim header (name, GC, bid total) and four tabs:
  **Takeoff · Estimate · Bid recap · Proposal**. Takeoff is the CRM's takeoff tab
  (upload, find walls, set scale, measure) with a full-screen workspace at
  `/bid/workspace/<id>` and the wall-legend review at `…/takeoff/legend`.
  Estimate is the line items, the wall schedule and saved versions. Bid recap is
  its own tab (a section of the Estimate tab in the CRM). Proposal is the CRM's
  printable proposal, bid package and clause builder. An estimate that has been
  awarded shows a sentence instead of tabs.
- `/bid/price-book` — the CRM's catalog: the same add form, the same price-list
  import, the same rows. `/bid/settings` — default markup and waste, the opening
  deduction habit, the proposal clause library, GCs (add one, list them) and the
  crafts the account already has.

**How the CRM was left alone.** Every shared screen takes a `surface` ("crm" by
default). `lib/bid/surfaceHrefs.ts` maps it to the links: its CRM half is today's
hrefs, byte for byte (`surfaceHrefs.test.ts` pins each), so no CRM page changes.
The leaking links, by component: `WallSchedule` (`/wall-types`),
`TakeoffAssemblyPanel` (x2), `TakeoffWorkspace` (back to the estimate, and the
assembly panel's wall-types link), `TakeoffCurrencyBanner` (`/bids`),
`ProposalClauses` (`/proposals`), `BidPackageBuilder` (`/messages` — Bid has no
log, so it draws no link — and the estimate-check findings' `fixHref`, which the
agents' lib builds as CRM routes, so Bid lists the finding without its link),
`NoAccess` (`/dashboard`), the takeoff tab (`legend.reviewHref`, the estimate and
workspace links), and the proposal page's two estimate links. Each is a prop whose
default is the old literal, so the CRM component is unchanged.

The Estimate tab's body moved, unchanged, into `components/job/EstimateStage.tsx`
(four sections) over `lib/estimating/estimate-data.ts` (the loader), and the
catalog page's add form, header and entry row into `components/CatalogParts.tsx`.
**That is the one change that can conflict with someone else's open work on
`estimate/page.tsx` or `catalog/page.tsx`** — the page shrank by ~950 lines; if you
have edits there, re-apply them to the moved block. Everything post-award stays in
the page: the lock-in gate, job costing and WIP, change orders, DocuSign.

`createJob` got a `returnTo` field: a WORD from a fixed list
(`lib/bid/jobStartDestination.ts`), never a URL. Anything else — absent, empty,
`//evil.example`, `/jobs` — falls through to the CRM stepper as before.

**Censuses.** `bidLinkCensus` grew four sections, because a link in Bid is now
mostly `href={hrefs.x}` and the old reader could only name it:
1. every value `surfaceHrefs("bid", …)` returns, and every destination
   `jobStartDestination` can produce, is CALLED and classified;
2. the body of every Server Action Bid's files import is read for `redirect()`
   (its sight used to end at `lib/`; `createJob` is the one computed redirect, named
   with its reason);
3. every use of a shared component whose signature takes `surface?: Surface` (or
   `returnTo?: JobStartReturn`) under `app/bid` and `components/bid` must pass
   `"bid"` — derived from the component's own source, not a list;
4. the dynamic-sink allowlist grew by the new sinks, each with why it is safe.
`bidRouteCapability.test.ts` is the access census for `app/bid` (which
`permissions.test.ts` never walks): every page has a row in `BID_ROUTES` (twin
route and capability), enforces `requireCapability`, directly or through the CRM
page it renders, and for every job function holding Bid's gate implies holding the
twin's. Two CRM census files were edited, minimally: `permissions.test.ts` now
accepts extra props on `<NoAccess capability="…" … />`, and the reachability
needle for the legend link is `hrefs.legend`.

**Not done / decisions for the founders.** `BidWizardSteps` is not used (it is the
CRM's two-step stepper with hard-coded `/jobs/new…` hrefs; Bid has one step, the
estimate's tabs are where work is added). Saving the markup and the opening
deduction still needs MANAGE_COMPLIANCE (and owner, for the second), exactly as on
the CRM's Settings — an ESTIMATOR sees the values and a sentence. Crafts are
listed, not edited (they hang off union locals). The Bids screen is still the
foundation's.

**Check it.** `e2e/specs/bid-estimates.spec.ts` (TAKEOFF persona, serial) walks
list -> start -> every tab -> workspace -> price book -> settings -> 375px, and
after every page asserts no `a[href]` leaves Bid. It could not be run in the agent
container (Clerk's host is denied); CI's `e2e` job is where it is proved.
