### Six specs said the Estimate tab was missing; the tab was there (Diego)

`diego/stage-nav-fix`

`main` has been failing six e2e specs since the new shell landed — the
estimating desk, the job detail tabs, retainage, plan ingestion, on-screen
takeoff and the run sheet. Every one of them read as *"the Estimate tab is
missing"*, which is exactly what a person looking at the new UI had reported for
an unrelated reason (a production build that predated #757).

**The app was never at fault.** Reproduced locally and read off the failure's
own page snapshot, the job's row holds every tab with the right href:

```
Overview · Estimate · Takeoff · Crew & time · Compliance · Field reports · Photos
```

#### What actually broke

`e2e/lib/journey.ts` was written against the shell #748 shipped, where each
stage box opened **its own** row of pages — `<ul aria-label="<Stage> pages">` —
with only the open stage's row in the DOM. #757 replaced that with ONE row
listing every page, in a sibling `<nav aria-label="Job sections">`.

Two helpers still looked for the old shape:

| | |
| --- | --- |
| `jobTab()` | `jobStageNav(page).getByRole("list", { name: / pages$/ })` — matched nothing |
| `allJobTabs()` | clicked each stage box and read that stage's row — a walk with nothing left to walk |

And two specs still expected the tab a contracted job used to show: the estimate
route was labelled **"Change orders"** once a job left ESTIMATE, and filing it
under Contract by that name is what hid the estimate tools on a running job —
the thing #757 undid. It is "Estimate" at every stage now. The page is
unchanged: on an IN_PROGRESS job it still leads with job costing and the change
orders, which is what the headings assert.

#### Verified by running them

| spec | before | after |
| --- | --- | --- |
| `estimating-spine` | 1 failed, 9 did not run | **11 passed** |
| `job-detail` | failed | **1 passed** |
| `journey` | failed at step 8 | **12 passed** |
| `shoot-rehearsal` | failed | **12 passed** |
| `takeoff-plan` + `plan-ingest` | failed | **12 passed** |

#### A note on what a full local run says, which is nothing

Running the whole signed-in suite afterwards reported 31 failures. Every one is
`Failed to sign in` — the dev Clerk instance throttling after six suite runs in
an hour, which this repo already has a note about. No assertion failed. The
per-spec runs above are the evidence; a rate-limited run is not about the app.

#### The lesson, which this repo keeps paying for

A locator that stops matching does not say *"I stopped matching"*. It says the
thing it was looking for is gone — and six specs then agree with each other,
convincingly, about a defect that does not exist. Read the page snapshot before
believing the app broke.
