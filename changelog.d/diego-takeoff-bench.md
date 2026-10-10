### A building we drew ourselves, so every miss has a number (Diego)
`diego/takeoff-bench`

Wall detection and auto-scale had been measured on seven real sheets with **no
ground truth** — #666 said so in as many words — so recall was a guess and
"0 wrong scales" was a count of the sheets that happened to be tried. This is
the instrument that makes both a measurement: a fictional two-storey medical
office (Mesa Ridge, ~38,800 SF) generated from one model, drawn as a full bid
set (11 sheets), exported 16 ways — Revit-style fills and duplicates, AutoCAD
Form XObjects and an xref, `/Rotate 90` with a CropBox, half-size prints,
outlined text, hidden layers, a clip path, dashed demolition, a scan — through
two unrelated PDF producers (a hand-written writer and Chromium/Skia), plus 20
seeded holdout plans. The answer key comes from the model, never from the PDF.

**No product code changes.** The harness calls the real pipeline —
`pageInventoryWork` for scale, the viewer's wall chain, `scheduleLines`,
`tableRowsFromPage`, `takeoffCurrency` — and writes `reports/takeoff-bench/`.

## What it found (against `main` at #681)

- **Recall is about two thirds.** Clean L1: 1,410 of 2,165 ft (interior 87%,
  exterior 10%); L2 66%; holdout 84% where readable. Fifteen mechanism probes
  isolate why, calling the viewer's own entry point `wallsFromBothEngines`;
  thirteen are confirmed defects with the product's own output: multi-line walls
  rejected as hatching, a gridline 8" off a wall cancelling it, a T junction
  losing a third of the wall, 1-1/2" furring under the thickness floor. #681's
  merge fixed one — duplicate strokes no longer double-count.
- **`sheetStrokes` never reads `paintFormXObjectBegin`**, which is where pdfjs
  reports a Form XObject's `/Matrix` — so a block-based export finds no walls.
  Also ignored: optional content, clip paths, dashes.
- **Five wrong-but-confident scales**: a half-size print's title block taken at
  face value (ANSI B and ARCH B are both "standard" sizes), and a two-scale
  sheet named with one scale and no zone warning.
- **The recipe math is exact** — the app's `scheduleLines` matches an
  independent hand calculation to the unit, and `bench.test.ts` now holds it.

## Checks

`bench.test.ts` (4 tests, every PR): the key covers the model, the drawn faces
register where the key says (mutation-proved — shifting the display map by one
point reds it), the holdout is deterministic, and the recipe math agrees. The
eval is a named keyless exemption in `harness.test.ts` and asserts it read path
operators before printing a figure. `SUMMARY.md` is the plain-English version.
