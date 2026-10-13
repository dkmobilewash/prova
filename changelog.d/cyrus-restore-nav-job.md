### The job's tab row is back under the stage boxes, and "Estimate" is called Estimate at every stage (Cyrus)
`cyrus/restore-nav-job`

#748 swapped the job page's tab row for five stage boxes, and half the job
felt deleted: each section was inside one stage's dropdown, and after the
contract the estimate route was filed under Contract as "Change orders" —
which hid the wall schedule, bid recap, missing indirects, cross-checks and
price anomalies that still live on it. Nothing had gone; it was out of sight.

The boxes stay as the progress bar. Directly under them is the old row —
Overview · Estimate · Takeoff · Crew & time · Compliance · Billing ·
Retainage · Field reports · Photos — on every stage, with exactly the pre-#748
gating (`components/job/jobTabs.ts`; `jobTabs.test.ts` checks it against a
copy of the old rail for all 32 viewer/stage combinations). The open stage's
second row of links under the boxes went, because it now duplicated the tab
row. The Estimate step links `/estimate` as "Estimate" whenever the viewer is
shown job money; change orders keep their own Paperwork row at
`#change-orders`. The proposal and certified payroll, reachable only from
inside the Estimate and Crew & time tabs, are now Paperwork rows too, each
gated on the capability its own page requires.

`JOB_TAB_ROUTES` is the list the reachability census reads; a test holds it
equal to what `jobTabs` yields for an owner on a contracted job, so the two
cannot drift.
