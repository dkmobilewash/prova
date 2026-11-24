### One sheet gets the same detection time in the browser and on the server

The browser's Run takeoff gave a sheet 180 s and server detection 45 s. Broadway A1.0 took 44.1 s on the server
under load, so whether its walls came back depended on how busy the machine was. It came back out of time, with
nothing, in two passes, while the browser listed 44 runs. Both sides now read `SHEET_DETECTION_BUDGET_MS`
(180 s, 4x the slowest of 115 measured sheets; prereg-detection-budget.md).

Every function that runs a sheet's full budget now has room for it:
- the takeoff workspace route and `/api/plan-ingest/advance` declare `maxDuration = 300` (Hobby's ceiling) instead
  of trusting the project default;
- a whole-set WALLS slice is claimed for 270 s (`WALLS_LEASE_MS`), so its 265 s work timeout no longer cuts off
  detection at 85 s, and a second worker cannot take the sheet mid-find.

The two paths that live in a 60 s function keep 45 s explicitly (`SHORT_FUNCTION_DETECTION_BUDGET_MS`): the daily
ingest sweep, and the suggestion refresh. Out of time there is a retryable row, never "no walls".

Check: `detectionBudgetCensus.test.ts` (11 mutations, all red). A platform limit is not observable from vitest, so
the click-list times Broadway on a preview.
