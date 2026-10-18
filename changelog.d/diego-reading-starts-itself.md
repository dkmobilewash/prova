### Uploading a plan set now reads it

Uploading a plan set did **nothing**. `startPlanIngest` had exactly two callers
and both were buttons, so a set sat unread until somebody found the panel and
pressed "Read the sheets" — and everything downstream waits on that pass: the
sheet numbers, the titles, which sheets are worth a takeoff at all, and the
per-page scale readings that prefill a calibration.

Now the free pass starts on its own. The panel's pump already existed; this
removes the press in front of it.

### Why this stage may start itself and the next one may not

`PAGE_INVENTORY` calls no model. `stageCost.ts` says so in the table the Retry
buttons read: *"Reads the PDF. No model call, so a retry costs a fetch and a
parse."* So starting it spends nothing of anybody's allowance.

Reading the title blocks claims a plan sheet per page, and this panel's own
comment records the decision that governs it:

> **A SEPARATE BUTTON RATHER THAN A CHAIN, Diego's call.** … Chaining would make
> one click spend that, with the figure only visible afterwards on
> `/settings/assistant`.

That is untouched, re-confirmed with Diego this session, and a test fails if this
ever starts the paid stage instead.

### What it will not do

Guarded on **no run of any stage having ever existed** for the plan, rather than
on progress. So it cannot restart a finished run, cannot resume a paused one
behind somebody's back — that still shows "Paused" and waits for "Keep reading",
because resuming is a decision about work already begun — and cannot fire on a
set whose title blocks are the newest run.

The "Read the sheets" button stays, and is not decoration: `startPlanIngest`
refuses a set over 2,000 pages, a file it cannot read, and a caller without
`VIEW_JOB_COSTS`. Each of those leaves the panel with no run and a sentence
beside it, and no way to try again would be a dead end. It is also the literal
call `stageReachableCensus.test.ts` reads, which exists so a stage cannot be
built, metered and unreachable — the shape #551 shipped.

### Verified

Preflight's four gates green, no production schema touched.

**Five mutations, all red**: starting on a set already read, the once-guard
removed, resuming a paused run, starting the paid stage instead of the free one,
and starting nothing at all.

**One of those was green until the test was fixed, and the test was the problem.**
The once-guard exists because React double-invokes effects in development, and
the first version of that case mounted normally and awaited twice — which does
not re-run an effect whose dependencies have not changed. It passed with the
guard **removed**. The honest version renders the panel inside `StrictMode` so
React actually double-invokes it. A test that cannot fail for the reason it was
written is the thing this repo keeps paying for.
