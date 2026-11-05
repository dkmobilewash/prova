### A job that is an estimate says where it is and what is next: Job → Plans → Scale → Takeoff → Review → Estimate → Send

- **What it is.** A slim bar on every tab of an estimate, under the tab row, for whoever prices the job (`VIEW_JOB_COSTS`).
  - Each step says done, current or not started in words as well as a mark.
  - Every step is a link, in any order: it is not a locked wizard.
  - Takeoff and Review open the full-screen workspace in a new tab.
  - The current step gets the one **Next:** button: Upload the plans, Set the scale, Run the takeoff ↗, Review N walls to confirm ↗, Put the takeoff on the estimate ↗, or Send it for signature.
- **Derived, not stored** (`lib/job-steps.ts`), from five counts on the job's newest plan set (`lib/job-steps-query.ts`): plans uploaded, sheets scaled, shapes measured, walls held "to confirm", estimate lines and signature requests.
  - Estimate and Send reuse `estimateStage`, so this bar and the jobs list cannot disagree about "sent".
  - **Current** is the first step not done after the furthest one that is. A job priced without plans is on Send, not sent back to Plans.
- **Built from a walk of today's path** as a brand-new company (`coordination/new-job-walkthrough.md`; the spec is `e2e/local/new-job-walkthrough.local.spec.ts`, run with `--real-plans new-job-walkthrough`). Two of its findings shaped the bar:
  - Takeoff reaches the estimate from the workspace's item panel, so Estimate's Next goes there.
  - The proposal page has no send. A job is sent with a signing link on the overview, so Send goes to `#contract-signature`.
  - **The walk's biggest finding is NOT fixed here.** Walls added "as plain measurements" file under Unassigned. Send to estimate exists only on an item, so a new company's takeoff stops one step short of the estimate.
- **A new e2e persona, NEW_JOB**, which nothing seeds, so its first sign-in is an empty company. Its phone is 0173: 0123 was already on another account on the development instance.

Check:
- `job-steps.test.ts` covers each fact moving the bar; Review held open by walls to confirm; skipped steps; signed counting as sent; only Takeoff and Review opening new tabs.
- `jobStepper.render.test.tsx`: seven links with their states in words, one Next, the takeoff in a new tab.
- `job-stepper.spec.ts` walks a brand-new job from upload to something taken off, reading the bar after each step. It checks that Next opens the workspace in a new tab while the job tab stays, that a step not reached still goes there, and that at 390px the page does not scroll sideways (it did, by 260px, until the row was made `relative` for its `sr-only` words).
