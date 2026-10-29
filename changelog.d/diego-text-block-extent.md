### A heading owns its words, not the column beneath them (Diego)

`diego/text-block-extent`

NG McAllen A3.2's plan lost its east wall — two 39 ft walls, 118 ft of traced key,
every one of their 248 faces outside the plan's boxes — because DIMENSION PLAN NOTES is
lettered at the TOP of the plan's own region with no other caption line crossing that
column, so the piece under the heading ran the full page height and #823's "only that
piece" handed the whole column to a text block: 14% of it notes, the rest the plan.

`placeDrawings` now takes the sheet's words and ends a heading's claim where its lettering
stops — the last word reached without a gap of more than `NOTES_END_GAP` (about an inch),
plus the caption margin — and puts the remainder back in the pool, where it is placed like
any other piece. Without words a heading keeps the whole piece, as before.

Measured on all 36 labelled sheets: only McAllen moved. Missing 274 → 141 ft, extra 80 →
119 — 133 ft of real wall for 39 of junk, 3.4 to 1. Every other sheet is byte-identical
on key, proposed, missing, extra, views and kept.

`sheetViews.test.ts` pins both halves: the heading keeps its six lines and the drawing
gets the rest of the column; with no words, the old behaviour.
