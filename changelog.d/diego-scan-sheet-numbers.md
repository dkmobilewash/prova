### A scanned sheet gets its number: the corner read on its own, in sparse mode, snapped to the set (Diego)
`diego/scan-sheet-numbers`

On a scan the sheet number is the biggest text on the page, and the tiled
OCR pass reads it worst: Evergreen's 106 title blocks gave five numbers,
four right, none of them an A-sheet — p22 came back `BUILDING D A244 1 B it`
for `A241B`, p105 `S112` for `S11.2`. Measured on those two before anything
was built: single-line and block modes read the corner wrong or not at all,
a character whitelist only zeroes the confidences (the LSTM engine ignores
it), and SPARSE mode at double size reads both right.

So `rasterizeSheet` reads the bottom-right corner once more that way, in a
second Tesseract worker so the tiled pass and its words — and therefore the
walls — stay byte-for-byte what they were, and takes the tallest confident
line that reads as a designation. The read is stored on
`PlanSheetRaster.sheetNumber` (migration `20261029160000_raster_sheet_number`,
one nullable column, applied to a throwaway Postgres for the db test) and the
workspace uses it as the picker label for a scan — a jump target, never a
name on a quantity.

Evergreen, against a by-eye key of all 106 sheets kept outside the repo:
**4 → 71 of 106 right, A-sheets 0 → 37 of 49**. `realplan/sheetNumbers.eval.ts`
is the keyless eval that counts it. The third step of the plan — snapping a
read to the set's own vocabulary of designations — was built, measured, and
removed: 71 → 67, because a right read one edit from a neighbour named on two
pages moved to the neighbour. `NOTES-sheet-numbers.md` has the misses and the
two caveats.
