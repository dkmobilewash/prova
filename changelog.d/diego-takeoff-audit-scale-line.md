### The scale line stops looking like a wall run

An orange dashed line crossing the whole drawing was reported on two unrelated
real sheets, at about the same height on each. It is the scale CALIBRATION —
the two points somebody dragged to set the scale — and it crosses the drawing
because a long calibration line is an accurate one. Not a detected run, not an
overlay fault.

**The confusion was ours.** The scale line drew as `#f0b429` even dashes;
`CLUSTER_COLOURS[4]` is `#fbbf24`, also drawn as even dashes. Those colours are
16 apart in a space whose diagonal is 441 — no difference at all. So on any
sheet with five or more thickness groups, one group's runs and the scale line
were the same mark, and the only way to tell them apart was to remember which
one you had drawn.

Fixed by shape rather than colour: the scale line is a dash-**dot** now, the
drafting convention for a reference line and a shape `markFor` cannot produce —
a cluster dash is always exactly two lengths and this is four. The palette is
left alone, because it is tuned and its own collision history is recorded in
`clusterMarks.ts`; swapping a colour there risks a new collision inside it.

`calibrationMark.test.ts` asserts the structural property at every index rather
than comparing two colours, so it stays true if the palette is retuned.
Mutation-tested with the old dash restored: two assertions red, each by name.

Detection is untouched and all three accuracy measures confirm it — real sheets
2 of 9 measured, twenty fixtures 13 of 17 within 2%, bench unchanged at 17/60
type-totals outside 2%.
