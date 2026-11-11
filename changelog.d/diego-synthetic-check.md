### A daily synthetic check on the demo environment, posted to #prova-build (Diego)
`diego/synthetic-check`

Pilots will hit the app before we do each morning, so once a day a GitHub Action
(`.github/workflows/synthetic-demo.yml`, 13:30 UTC, also runnable by hand) walks
what a pilot does first on a deployed preview of main: sign in, start a job, upload
a one-sheet plan, run the takeoff, open the review queue, the estimate and the
proposal. Each step is timed. The verdict goes to #prova-build: pass, slow (a step
over 1.5x and 5s more than its median of the last 7 passing runs), or failed with
the step and the reason.

Nothing is stubbed, which is the difference from CI's e2e: the upload is real, the
walls are found by the deployed code. It never touches production. Main has no
preview of its own, so the job points the branch `synthetic-demo` at main, waits
until that preview's page serves main's commit (its `dpl=`), then walks it: Preview's
variables, so the demo database and the development Clerk instance. It signs in as
one existing e2e persona every day, because that instance caps at 100 users.

Checks: `e2e/lib/syntheticReport.test.ts` (baseline, slow and fail rules, the Slack
text); the walk itself was run against this branch's preview before the PR.
