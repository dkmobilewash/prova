### #623's title-block check was dead on the only calibration that matters (Diego)
`diego/printed-scale-unreachable`

Found by clicking it, in a real browser, on production — the click-list from
#623's own PR body, step A2. `typecheck`, `lint`, 8,840 unit tests and two
mutations were green on that PR, and the feature never once fired.

**The failure, exactly.** A `PlanSheet` is built from a `TakeoffPlanPage` row,
and the **only** thing in the app that creates one of those is the
calibration-save upsert in `actions/takeoff.ts`. Plan ingestion does not: it
writes `PlanSheetText` and `PlanSheetProposal`, never a page row. #623 hung
`printedScale` on `PlanSheet`, so for a sheet nobody had calibrated yet
`sheets.find(...)` returned null, `sheet?.printedScale ?? null` was null, and
the comparison had nothing to compare — **on the first calibration of a sheet,
which is the only time it has anything to say.**

The tester's A-101 fixture had a confirmed `1/4" = 1'-0"` title block and a
calibration deliberately off by exactly 2× (`1 in = 7.99 ft`). Nothing appeared.

**Why it looked healthy.** Every other notice in that dialog is computed from
the draft line and the live `pageWidthPt` the viewer reports — the scale
readback, the sheet width, the error band — none of which touches a stored row.
So the dialog was visibly working, and the single addition that needed stored
data was the one nobody could see. Third time this week: #622's link control,
expo-router's header options, and now this. **A test on a pure function proves
the function works and says nothing about the value reaching it.**

**The fix deletes the field rather than patching it.** `PlanSheet.printedScale`
is gone and the scale travels as `PrintedScaleByPage` — a map keyed by PAGE
NUMBER, which exists whether or not anybody has calibrated that page. So
`sheet?.printedScale` is now a **type error**, which is the only guard that
cannot rot: the mistake is unrepresentable rather than merely corrected.

`printedScalesFromProposals` carries the one piece of logic left that can be
got wrong — newest-first wins, a null scale is skipped rather than stored as an
empty answer, `"AS NOTED"` is carried verbatim because deciding it names no
scale is `standardScaleFromText`'s job. Five tests; the mutation to
last-write-wins reds the newest-wins one.

**What this does not fix, and is worth saying.** A2 is now reachable, and the
only proof that it FIRES is the same click-list step that caught it. A unit
test cannot render the viewer — it loads pdf.js and draws to a canvas — so the
browser remains the instrument here. Re-run step A2 before believing it.

`typecheck`, `lint`, 569 files / 8,854 unit tests. No schema, no migration.
