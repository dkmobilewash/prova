### A won bid can be marked contracted from the job itself, and Jobs is a page again (Cyrus)
`cyrus/fix-jobflow`

Five findings from the contractor-persona UX test of 2026-10-11, all on the
path from "we won the bid" to "the job is in the list".

**A won bid could not be moved to Contract.** "Mark contracted" lived only at
the bottom of `/jobs/[id]/estimate`, and the sentence pointing at it said
"the Estimate tab" — a tab the five-step job page no longer has. The Contract
step's own links were Overview and Compliance while the job was still a bid,
so a tester clicked Contract, landed on Overview, and went round again
(COMBINED.md #1). Now the job header shows a **Won it?** box on every tab
while the job is a bid: with the GC's signature or an executed subcontract on
file it holds the existing `MarkContractedButton`; without one it links to
Contract signature, because a button that would refuse is worse than a link
that says what to do first. The action is `markJobContracted`, unchanged — the
header binds it only for a viewer with VIEW_JOB_COSTS, the same gate the
action asserts. Every user-facing "Estimate tab" now says "the estimate page
(the Estimate step)"; code comments and test names were left alone.
`JobSummaryHeader.test.tsx` fails if the box disappears or appears on a
contracted job; `JobStatusControl.test.tsx` fails on the stale copy.

**The header said "Contract $380,000 / Left to bill" on a job still
bidding.** Display only: while status is ESTIMATE the figure is labelled
**Bid** and the two billing figures are not shown, since they would restate
zero. No money math changed — `loadJobSummary` is untouched.

**Top-bar Jobs only scrolled the home page.** `/jobs` was a redirect to
`/dashboard`, the searchable list sat at the bottom of home, and a search
reloaded to the top with its answer off-screen (#2, four independent
sources). `/jobs` is now a real list page: search box and stage filter chips
at the top, URL-driven (`?q=&status=`), grouped by stage, "+ New job" in the
corner. Desktop top bar, phone Jobs tab, the Jobs & bids area tile, the job
header's back link and `/estimating` all point there. Home keeps its job
cards and links to `/jobs` for the rest; the one job read behind both is
`lib/jobs-list.ts`, so the two cannot disagree. `jobs-page.test.ts` renders
the real page against a recording fake database and checks the query, the
Enter-submits GET form, and the "No jobs match" empty state — which is the
fix for the search that "neither filtered nor said no matches".

**The new-job form.** The heading said "Start a bid" under a button that said
"+ New job"; it now says "New job — it starts as a bid". Enter in the GC
picker or the add-a-GC boxes no longer submits the whole form (Enter in Job
name still does; `newJobForm.test.tsx`). The submit button is sticky above
the phone tabs, so opening "+ Add a new GC" cannot push it below the fold.

**"That didn't save", followed by the job appearing five seconds later.**
Real, and not the dev server. `createJob` ends in `redirect()`, which THROWS;
called from `ActionForm`'s handler rather than the `action` prop, Next 15.5
rejects the call with the redirect error while the router is already
navigating. `ActionForm` caught it as a failure and showed "That didn't save"
for as long as the next page took to render — on a job that had saved, which
is an invitation to make a duplicate. A redirect error is now treated as the
success it is (`isRedirectError`); `actionForm.test.ts` fails if it reads as a
failure again. The submit button was already disabled while in flight.

Not changed: `markJobContracted`'s internals and gates, `loadJobSummary`, and
every money figure (Diego's lane). The Overview page got an `id` anchor on
its Contract signature section and nothing else.
