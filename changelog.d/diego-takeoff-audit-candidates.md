### A one-drawing sheet is still not the whole sheet, and a reviewer is asked only what the app cannot answer

A102 offered an answer-key reviewer **283 candidates: 115 detected runs and 168
possible walls**. Most of the 168 were the title block's ruled lines, the
revision and notes boxes, column grid lines running past the building, and
hatching. It is now **117: 115 runs and 2 possible walls**, with 136 lines set
aside by name.

**The plan's own region went unused on sheets with one drawing.**
`viewRegions` already separates them — on A102 the drawing holds 135,042
strokes, the title-block strip 8,395 and the dimension strip 1 — and a sheet
with one caption hands all three to it, because a region with no caption joins
the nearest. That rule is right and stays: it is what keeps a plan's dimension
column with its plan, and reversing it once sent S05 and S07 to zero feet.
`planRegion.ts` keeps the busiest region and whatever is comparable to it, so a
plan split by a courtyard stays whole while a title block does not join it.

Candidates are now built from the strokes the MEASUREMENT used rather than from
the raw page, so they pass through the layer names, the set's template and the
grid-bubble removal like everything else.

**And the classifier's verdict is finally acted on.** `classifySingleLines`
already names each unpaired line — `in-a-hatch`, `past-the-building`, `dashed`,
`small-closed-shape` — and every one was offered anyway. On A102 that is 133
hatch lines, 2 symbols and 1 grid line out of 136. Only `unclassified` is
offered now: the ones the app looked at and could say nothing about, which is
exactly what a reviewer is for.

Nothing is hidden. The panel reports what was set aside and by which reason,
with "Offer these too" beside it — a reviewer who cannot tell that the app
decided for them is reviewing the app's opinion rather than the drawing, and a
key made that way grades the detector against itself.

### What the X patterns on A102 actually are

Pairs of ~17 ft diagonals at 35° and 145°, crossing corner to corner inside the
rooms captioned INDOOR PLAY YARD 3 and INDOOR PLAY YARD 4 (rooms 127 and 128).
An X drawn across a room is a keying convention, not construction. They are
classified `in-a-hatch` and are no longer offered.

### A measurement that refuted the obvious fix, recorded so nobody repeats it

The striped box at A102's left edge is 352 diagonal strokes a median 1.2 INCHES
long at a 0.57in pitch, and the pairer still returns walls on it.
`drawnCoverage` cannot catch it and should not: a DENSE fill genuinely does
cover the run beneath it.

The next idea was "a hatch's supporting strokes are shorter than the run", and
it is **false in the dangerous direction**. Measured over all 113 runs on A102,
the median supporting-face length as a fraction of the run is 0.00–0.01 for the
LONGEST REAL WALLS — a 120 ft wall has 101 short parallel faces in its band,
every door jamb and furniture edge along it — against 0.57 for the sheet as a
whole. A threshold there removes the building and keeps the hatch.

So that run is still offered, and it is one of 115. What would separate them
has not been found; `NOTES.md` has the numbers rather than a guess.

All three guards unchanged: 20 fixtures at 15 of 17, the bench at 111 walls
missed and 17 of 60 type-totals outside 2%, the real sheets at 8 of 9 measured
with identical footage — so the clip costs no real wall anywhere. The real-plan
eval clips the same way the viewer does, because an eval that measures the
whole sheet while the app measures the drawing is grading something the product
does not do.
