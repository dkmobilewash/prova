### A path that paints nothing was never on the sheet, and a table's rules are not a wall (Diego)

`diego/junk-rules-2`

Two more junk rules from the product-path census (`zzJunkKinds`, on `diego/dashed-faces`),
each priced on every offered candidate of the training sheets before it was written and
then measured on the 36-sheet sweep with the sheet's words handed to the triage — which
the sweep had been leaving out, so #824's site-equipment rule and any text rule measured
as zero change in it until now.

**Clip paths.** The operator after `constructPath` says what a path does: stroke, fill,
or `W n` / `W* n` — set a clip and draw nothing. A CAD export is full of them: 42,047 of
Topeka p76's 98,222 input strokes, 36,167 of Bunkie A104's 73,563, 17,077 of E Street's
42,128, every viewport and block and hatch boundary. They pair like faces, and a
candidate whose face is drawn 95% by clip paths is junk 126 times out of 127 by the
labels (278 ft against 2). `sheetStrokes` now skips them the way it skips an OFF layer,
and reports the count (`unpaintedPaths`) beside `pathOperators` so the control still
says what the page carried. Sweep: training extra −409 ft for missing +66 (Topeka p74
+31, p75 +25, p76 +13 — clip edges were the only face drawn there), no sheet worse than
31 ft net; held-out, delta only, extra −478 for missing +8, Gen BBQ −378 of it.

**Table rows.** Two rules of a hardware schedule, a notes box or a legend, a few inches
apart with a row of text between each pair, read as a wall when the schedule sits in the
plan's own column (SW A110, Joplin, E Street). Three or more non-dimension words between
the faces along the run and at most one run meeting it sets the pair aside as
`table-rows`. Priced 301 ft of junk for 7 ft of real wall (43 to 1); sweep: training
extra −365 for missing +0 (SW −300, E Street −57), held-out −62 for 0.

Recorded and NOT shipped: the "second candidate along a real wall" kind (1,905 ft) is
mostly not a duplicate — 1,696 ft of it has ZERO overlap with the real wall it was
matched to; it continues the wall's line past its end (a radiator, a notes-box rule, a
dash-dot setback line), so the review tool's 1.5 ft / 70% duplicate check cannot see it,
and that check applied as a filter would drop 2,732 ft of real wall for 817 of junk.

`unpaintedPaths.test.ts` drives the reader with a synthetic operator list (stroked and
filled paths read, clipped and ended ones not, the control count intact);
`textRows.test.ts` pins the word count, the dimension exclusion, the tees and the tagged
wall that partitions meet.
