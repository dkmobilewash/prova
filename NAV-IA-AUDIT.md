# Nav information-architecture audit — 3 Sep 2026

Why this exists: a request came in to cut 8 nav items (plus a claimed
standalone "Estimates" slot) on the premise that they were disabled
"coming soon" placeholders from an external "dual-persona adaptive
layout" spec, never validated against what a WWCCA specialty sub (lath &
plaster, EIFS, acoustical ceilings, fireproofing — a handful of
employees, a few commercial jobs a year) actually needs day to day. The
premise was checked against the repo before any code changed, per this
project's standing rule to verify by result rather than by claim. It was
wrong for 6 of the 8 items: RFIs, Submittals, Drawings, Closeout, Safety
and Material Orders were not unbuilt placeholders — they were (and are)
fully built, tested, live features, confirmed both in `FEATURE-AUDIT.md`
and by their real routes building successfully. `navItems.tsx` itself
already carried a comment from an earlier pass making almost this exact
correction:

> An earlier plan for this rail assumed eight of these were unbuilt and
> should render disabled with a "coming soon" tooltip; they all shipped
> during the day it was written, so disabling them would have removed
> working features from the nav.

This was surfaced to the project owner twice before any nav change was
made. Both times, the decision to proceed was confirmed explicitly, for
product-scope reasons — not because the build-status claim turned out to
be true, and not silently. This document is the record of what was
actually found, what was decided anyway, and why, so a future contributor
can override any one call here without re-deriving the whole audit — and
without mistaking this for the same mistake the earlier comment already
warned against. It is a different decision than "these aren't real,"
made with full knowledge that they are.

## Method

For each item: what the originating request claimed, what `FEATURE-AUDIT.md`
and the actual codebase show, the final call, and the one-line reasoning
for it. Build status was checked by reading the relevant `FEATURE-AUDIT.md`
sheet directly and confirming the route still builds; nothing here is
inferred from the request's own framing.

## The audit

| # | Item | Original claim | Actual evidence | Final call | Reasoning |
| --- | --- | --- | --- | --- | --- |
| 1 | **Cash Flow** | One item with real evidence behind it — a genuine daily gap from prior workflow research, tracked as "Missing" in `FEATURE-AUDIT.md`. Possibly a dangling unmerged branch rather than needing a fresh build. | **Already fully built and live.** `lib/cash-flow.ts`'s `calculateCashFlowForecast` (AR aging + retainage-by-month) is wired into `/cash-flow` and rendering under "Forecast, next N months" today. `FEATURE-AUDIT.md` sheet 15 was simply stale, still marked "Missing" — corrected in this same pass. Not dangling or unmerged; it's on `main`. | **KEEP, no change.** Already exactly what the request wanted: visible, working, prioritized by virtue of already existing. | Nothing to build or flag as next-priority — it's done. The only action needed was fixing the stale audit-doc entry, which this PR does. |
| 2 | **RFIs** | Unbuilt "coming soon" placeholder; GC-side workflow a sub doesn't run. | **Fully built.** `Rfi` + `RfiCounter`, `/rfis` — numbered per job, never reissued, overdue/cost-impact derived. `FEATURE-AUDIT.md` sheet 16: Built. | **CUT from nav** (removed from `NAV_ITEMS` and `NAV_GROUPS` entirely, not disabled). Route, model, actions, migration all untouched — still reachable by direct link. | The build-status half of the claim was wrong, but the scope argument stands on its own regardless: a sub receives RFIs from a GC, it doesn't run an RFI log as its own workflow. Confirmed with the project owner after the false premise was surfaced. |
| 3 | **Submittals** | Same as RFIs. | **Fully built.** `Submittal` + `SubmittalRevision` + `SubmittalCounter`, `/submittals` — per-revision approval outcomes derived, never stored. Sheet 16: Built. | **CUT from nav.** Same terms as RFIs. | A sub submits TO a GC; it doesn't run submittal review as its own module. If "my submittals pending GC approval" ever matters, that's a small status addition inside the existing Jobs view, not a standalone nav bucket — not built in this pass. |
| 4 | **Drawings** | Same as RFIs. | **Fully built.** `DrawingSet` + `DrawingRevision`, `/drawings` — current-revision and "issued but never received" both derived per render. Sheet 16: Built. | **CUT from nav.** Same terms as RFIs. | A full drawings/markup/sheet-management module is exactly the crowded category (Procore, Fieldwire, Bluebeam all own this deeply) this product shouldn't try to out-build. A sub's real need — viewing/downloading drawings attached to a job — is a file-attachment concern inside the existing Jobs detail view, not its own module. Not built in this pass. |
| 5 | **Closeout** | Same as RFIs. | **Fully built.** `CloseoutSubmission`+counter, `CloseoutItem`, `WarrantyPeriod`/`WarrantyServiceRequest`, all on `/closeout`; readiness derivation pulls in punch items and retainage. Sheet 22: Built. | **CUT `/closeout` from nav only.** `/punch-lists` is a separate route hosting punch list tracking and was NOT touched — that stays a normal, fully nav-reachable item. | Closeout package submission and GC sign-off is the GC's approval workflow; a sub's own punch-list work (still fully in nav) is the part that's actually theirs day to day. |
| 6 | **Safety** | Unbuilt, no evidence in prior workflow research of being a top daily gap; not clearly a different company's job. | **Fully built.** `SafetyIncident`+`SafetyCaseCounter` (OSHA 300 log), `ToolboxTalk`, both on `/safety`. Sheet 17: Built. | **DISABLE in nav** (`disabled: true`, rendered "coming soon" on both desktop rail and mobile drawer), not removed. Route/model/actions untouched. | Confirmed disabled anyway despite being built, per explicit override — a sub does have real safety obligations, so this stays a "not validated as a daily priority yet" call, not a "wrong company" one, and stays reversible by flipping one flag rather than rebuilding a cut nav slot. |
| 7 | **Material Orders** | Same as Safety. | **Fully built.** `MaterialOrder`+`MaterialOrderDelivery`+`MaterialOrderCounter`, `/material-orders` — late/delivery state derived, never stored. Sheet 19: Built. | **DISABLE in nav**, same terms as Safety. | Same reasoning as Safety: a sub does order materials, so this is a "not proven as a daily gap yet" deferral, not a scope mismatch — confirmed disabled anyway per explicit override. |
| 8 | **Standalone "Estimates" nav slot** | Duplicates Jobs/Catalog functionality; flagged as redundant during the dashboard work and never given a route; should be formally cut. | **Does not exist.** No `/estimates` route, and no standalone "Estimates" entry in `NAV_ITEMS`/`NAV_GROUPS` today — `/estimating` exists only as a bare redirect to `/dashboard` (see `lib/permissions.ts`'s own comment on it) and was never a nav item either. | **No action — nothing to cut.** | The redundancy call itself is sound (estimating lives in Jobs' `ESTIMATE` status and Catalog), it's just already fully resolved; there was no disabled icon or dead slot to remove. |

## Nav restructuring after the cuts

Before this change, the five buckets held 22 items (not 18 — that count
predates several features this repo has since shipped): Pre-construction
(7: dashboard, alerts, bids, pipeline, contacts, messages, catalog) ·
Operations (7: schedule, RFIs, submittals, drawings, punch-lists,
field-reports, closeout) · Compliance & safety (5) · Logistics (4) ·
Financials (3).

Removing RFIs/Submittals/Drawings/Closeout drops Operations from 7 items
to 3 (schedule, punch-lists, field-reports). Pre-construction and
Compliance & safety are untouched in count — Safety stays in Compliance &
safety, just disabled, and nothing was removed from Pre-construction at
all, which corrects the original request's assumption that those two
buckets specifically would thin out.

**Kept Operations as its own bucket** rather than merging its remaining 3
items elsewhere. 3 items is not an unusually thin bucket — Financials
already has exactly 3 — and merging "day-to-day fieldwork not covered
elsewhere" into either Compliance & safety or Logistics would blur what
each of those buckets means rather than clarify it. Revisit if it ever
drops further.

## What changed vs. what didn't

**Nav-only**, as instructed: no changes to `JobLineItem`, `EstimateVersion`,
`ChangeOrder`, the `CONTRACTED` gate, job-costing logic, or any backend
code, route, model, action or migration for any item above — cut or kept.
`/rfis`, `/submittals`, `/drawings`, `/closeout` remain live, working
routes; they are simply no longer linked from `Sidebar.tsx` or
`MobileNav.tsx`. Reverting the nav diff alone restores full discoverability
with no other change needed.

One related fix while both nav components were open: `MobileNav.tsx` had
no handling for `item.disabled` at all — every item rendered as a live
`Link` regardless. Marking Safety/Material Orders disabled would otherwise
have made the desktop rail and the mobile drawer disagree about whether
those pages are reachable, which is exactly the "one fact in two places"
bug class `navItems.test.ts` (added 3 Sep 2026, same day) exists to catch
in the other direction. Fixed to match `Sidebar.tsx`'s existing behavior.
