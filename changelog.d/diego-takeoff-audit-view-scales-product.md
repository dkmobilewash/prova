### A sheet's drawings can each have their own scale, and one function decides

A sheet carrying several drawings at several scales got no scale at all.
Correctly — one page-wide scale would be wrong for every drawing but one, and
`scaleFromPrinted` refuses such a page outright because it cannot tell which
drawing each printed scale belongs to.

Now each view's caption is read against the region that drawing occupies, so
the scales stop competing: they are answers to different questions. The
workspace offers them — *"this sheet carries 2 drawings at their own scales —
pick the one you are measuring"* — and picking one proposes a calibration line
across that drawing's own region. Camp Bow Wow A120 measures 577 ft over 82
runs, which was unmeasurable before.

The line **invents no dimension**, which is the rule #623 set and
`scaleFromPrinted` kept: the region comes from the sheet's own gutters and the
feet are what the printed caption says that region spans. It is still the
weakest evidence of the three and the screen says so — nothing on the drawing
confirms a caption.

**Schema:** one nullable `PlanSheetScaleReading.viewScales` JSONB column. The
obvious shape — a reading row per view — means relaxing
`@@unique([planId, pageNumber])`, and `saveScaleReading` upserts *through* that
constraint. Migrations land seconds after a merge and the deploy takes minutes,
so the running build would spend that window upserting through an index that no
longer exists. A nullable column is invisible to it.

**And the part worth more than the feature.** The app and the real-plan report
both answered "what scale is this sheet at", and they answered differently: the
report ran `readSheetScale` and stopped, the app fell back to the printed
scale. Four real sheets were reported as "no scale" that the app reads
perfectly — the measure understating the product it exists to measure, for
weeks, until two numbers turned up that could not both be right. That is the
same shape as the profiler that divided by the page width twice.

The decision now lives in `sheetScale.ts` and both callers reach it.
`sheetScaleParity.test.ts` fails if either stops, checks the order at each
step, and refuses a stored blob it does not recognise — a view with a missing
region would otherwise be measured across the whole sheet at a detail's scale.
