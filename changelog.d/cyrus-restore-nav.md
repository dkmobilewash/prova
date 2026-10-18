### Everything we built is one click away again — sidebar, job tab row, and a census that keeps it so (Cyrus)
`cyrus/restore-nav`

Concept G (#748) took the left rail and the job page's tab row away. Nothing
was deleted, but about half of what we built had no visible door — ⌘K or the
avatar's "All pages" only — and after the contract the estimate route was
filed under Contract as "Change orders", which hid Diego's wall schedule, bid
recap, missing indirects, cross-checks and price anomalies. No test asked
whether a person could get to a page. Three things fix that, in one PR.

**The sidebar, from `lg` up** (`components/shell/Sidebar.tsx`). Every page the
viewer can open, under the six area names from the home boxes (Jobs & bids,
Money, Crew & field, Paperwork, Compliance & safety, Materials & equipment),
then the operator's Internal pages, then Account. Built from
`pagesByArea(navGroupsFor(…))`, the same pair "All pages" uses, so there is no
second list to drift. Groups collapse; the whole list collapses to icons; both
choices are remembered per browser inside try/catch. The current page carries
`aria-current`. The top bar, ⌘K, the home boxes and the phone's tabs are
unchanged; below `lg` nothing new renders. `sidebar.test.tsx` holds an owner's
list equal to `navGroupsFor` + the footer, once each (≥ 35 links), in area
order, and that a field user is never shown a page `canOpen` refuses;
`shellRegion.test.ts` pins the new region and its fallback.

**The job tab row, under the stage boxes** (`components/job/jobTabs.ts`,
`JobSectionNav.tsx`). The boxes stay as the progress bar. Directly under them
is the old row — Overview · Estimate · Takeoff · Crew & time · Compliance ·
Billing · Retainage · Field reports · Photos — on every stage, with exactly
the pre-#748 gating (`jobTabs.test.ts` checks all 32 viewer/stage
combinations against a copy of the old rail). The Estimate step is called
"Estimate" at every stage; change orders keep their Paperwork row at
`#change-orders`. The proposal and certified payroll are Paperwork rows too,
each gated on the capability its own page requires. The open stage's second
row of links went, because it duplicated the tab row.

**The reachability census** (`lib/reachabilityCensus.test.ts`). It walks every
`page.tsx` under `app/(app)` and fails unless each route is in the sidebar,
on an area page, in the top bar, in `JOB_TAB_ROUTES`, or on `REACHED_FROM` —
where every entry names the parent file that links to it and the test greps
that file (comments stripped), so a stale reason fails. It asserts its own
size (walk ≥ 70, equal to an independent `fs.globSync`, every git-tracked page
seen) and ratchets both ways. 28 of the 29 old-style pages in the shell moved
to `PageShell` + `PageHeader` (`UNCONVERTED_PAGES` 33 → 5); `PageHeader`
gained `parent` for nested pages; the printable documents print exactly what
they printed before; `/jobs/[id]/photo-report` was left (its figures are
centred with a cap the width census cannot tell from a container).

Check: on a laptop every page in the old sidebar is in the new one; a
contracted job shows the tab row and its Estimate tab opens the estimate
panels with change orders below; on any sidebar page the breadcrumb reads
Home / <area> / <page> and every button the page had is still there.
