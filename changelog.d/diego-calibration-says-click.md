### The scale tool said "drag" and the scale tool does not drag (Diego)
`diego/calibration-says-click`

Both of these came out of the click-through of #630 as side observations — the
tester reported them in a "things that weren't part of the test" list, and both
are real.

**Three user-facing sentences told the estimator to drag.** The tool is
click-once-per-end, and `TakeoffPlanViewer` says so on screen: *"Click once at
each end of a dimension printed on the drawing."* Dragging places the first
point and stops. The worst of the three is the one a confused person reads
FIRST — the refusal when no line has been drawn read *"Drag along a dimension
on the drawing first"*, which told them to do the thing that had just failed
them. Two of the three predate me; the third is mine, from #623.

Now: *"Click once at each end of a dimension on the drawing first."*, *"Pick a
longer dimension and click each end of it."*, and *"…otherwise check the
dimension you clicked along."* The `StoredCalibration` doc comment said
"dragged" too and now says what the tool does.

**PINNED, NOT JUST FIXED, because this is wording and wording drifts back.**
`takeoff-plan.test.ts` now collects the sentences from every branch of
`calibrationNotices` and asserts none of them says "drag" — there is nothing
here a type can catch and nothing a reviewer would notice, since *"Drag along a
longer dimension"* reads perfectly well to anybody who has not tried it. The
collector asserts its own SIZE and that at least one sentence names the click,
because an assertion that no message says "drag" passes trivially on no
messages at all. Mutation-proved: restoring one "Drag" reds two cases, one of
them naming the exact string.

**And a placeholder that read as a value.** The wall-height field on a measured
run showed `placeholder="9"`. The tester posted a run, got *"Height ft needs a
number"*, and had to go back and type the 9 they could already see. It is worse
when a wall type IS picked: the label then shows that type's own default — 10,
say — while the placeholder said 9, so one control carried two numbers and
neither was the value. It reads `e.g. 9` now, or `e.g. <the type's default>`.

It stays a HINT rather than becoming a prefilled default on purpose:
`planMeasuredWallRun` refuses a run with no height instead of assuming one, and
prefilling a real figure would be the guess that module declines to make — the
estimator would be agreeing to a height nobody chose.

**One thing from the same list that is NOT a bug**, recorded so nobody fixes
it: the four lines posted from a takeoff carry no cost, and the cross-check
panel says nothing about them. Correct — an unpriced line is a single-row
condition and `bid-recap.ts` already reports it (`pricedWithNoCost`,
`uncategorised`) alongside `bid-margin.ts`'s `NO_COSTS`. The cross-check panel
is for a quantity in one place with no line in another, and duplicating a
check that exists is how a panel becomes noise.

`typecheck`, `lint`, 570 files / 8,880 unit tests. No schema, no migration.
