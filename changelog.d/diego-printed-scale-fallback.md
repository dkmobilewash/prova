### 9 sheets to 24, by believing the title block and saying so (Diego)
`diego/printed-scale-fallback`

#655 reads a sheet's scale off the dimensions printed on it. A real 76-page bid
set showed what that covers: **9 of roughly 30 drywall-relevant sheets.** Sixteen
more PRINT their scale — `1/8" = 1'-0"`, `3/4" = 1'-0"` — and fail only because
no dimension on them can be read: six have their lettering saved as line work,
ten have dimensions that scatter past the vote's margin. Three geometry fixes
were built and measured at zero or worse; those tables are in
`scaleFromDimensions.ts` so nobody re-runs them.

**Measured, on the same bid set:**

| | before | after |
| --- | --- | --- |
| read from dimensions | 9 | 9 |
| read from the printed scale | — | **15** |
| a scale printed and not found | 16 | **1** |
| **wrong** | **0** | **0** |

The one remaining miss is a civil sheet at `1" = 30'`, correctly declined because
an engineering scale is a site plan and nobody takes drywall off one. All four
real drawings seen so far are now covered, including the one whose drawing-area
lettering had been flattened to line work.

## This reverses #623, and the reversal needs its own argument

That PR's reasoning stands: the printed scale *"implies a factor and not a
dimension"*, and a calibration *"is the line somebody drew… so the printed scale
cannot become one without inventing a second calibration mechanism with
different evidence behind it."* The safety is real — every scale
`scaleFromDimensions` produces traces to a figure printed on the drawing, drawn
back over it, so a wrong one is visible in two seconds.

What changed is the measurement above, not an opinion about the rule. Diego's
call, 2026-10-07: use the printed scale, clearly marked unverified.

**AND IT INVENTS NO DIMENSION, which is what keeps that rule intact in
substance.** The tempting shortcuts both put a number into
`declaredDistanceFeet` that no drawing states — store a factor, or pick a line
and compute what it "should" measure. Instead the line is **the sheet's own
width** and the distance is **what the printed scale says that width is**: the
page is 42 inches across and says 1 inch = 8 feet, so it spans 336 feet. Two
facts about the file, multiplied.

It round-trips exactly. `scaleFromPrinted.test.ts` runs all twelve architectural
scales back through the app's own `readScale` — not a re-derivation, which would
only prove both used the same formula — and each names the scale that was
printed. At a span of 1.0 of the page it is also the longest line available, so
`MIN_CALIBRATION_SPAN` is untroubled and the geometry is the least error-prone
there is.

## What it refuses, which is where the safety now lives

- **A half-size print.** A 1/8" ARCH E1 sheet printed at half size still SAYS
  `1/8" = 1'-0"`, and every quantity off it would be half. A dimension-based
  reading is immune — the dimension and its line shrink together, so it reads the
  honest 1/16" — but a printed one is not, because characters do not shrink. The
  page is the only giveaway: half of 42×30 is 21×15, which is no standard sheet.
  So the page must be a standard size (ARCH A–E1, ANSI A–E).
- **A multi-scale sheet.** A plan at 1/8" with details at 3/4" has no single
  answer, and #640 already warns about those. Six of the bid set are this.
- **An engineering scale**, a non-standard scale name, `AS NOTED`, `NTS`, and a
  missing page width — `pageWidthPt` is nullable and its own comment calls it "A
  LABEL INPUT AND NOTHING ELSE", so without it there is no arithmetic to do.
- **Anything, where the dimensions already answered.** The printed scale is a
  FALLBACK and never a first choice, because one can be checked against the
  drawing and the other cannot.

## And it says so on screen, which is the condition it was approved under

A dimension-derived scale is offered with the dimensions it matched and a line
drawn over one of them. A printed one cannot be verified by looking at anything,
so it reads:

> The title block on this sheet says **1/8" = 1'-0"**.
> Nothing measurable on this sheet confirms it — no printed dimensions could be
> read here. Using it sets the scale from the printed figure alone.

`source` on `PlanSheetScaleReading` carries the provenance, because it is not
inferable from which columns are null — a PRINTED reading stores a line too. An
UNKNOWN source counts as unconfirmed, deliberately: a row from a build that did
not have this column, or one that grows a third source later, must not quietly
claim to be checkable.

## Checks

**Ten mutations, all red**, each naming its offender — the fallback running over
a dimension-derived answer, the half-size check removed, the multi-scale decline
removed, an engineering scale accepted, a guessed page size, the line no longer
the full width, the distance dropping the scale, a PRINTED reading claiming to be
confirmed, an unknown source claiming it, and the audit counting a PRINTED page
as agreement.

**One existing test had to be rewritten rather than fixed, and the reason is the
feature working.** `pageInventory.test.ts` asserted that the title-block fixtures
yield no scale. They now yield one, because `planFixtures.ts:215` prints
`SCALE: 1/4" = 1'-0"` and the fallback reads it. The assertion was describing a
world with one reader in it; what must still hold — and now does, explicitly — is
that the DIMENSIONS reader produced nothing and the row says where its scale came
from.

The audit reports a `PRINTED` bucket so it describes what SHIPS rather than what
one reader manages alone, and that bucket is excluded from the agreement rate:
there is no second reading to agree with, which is the property the outcome
records the absence of.

Four gates: **9,248 unit tests, 678 db tests** on a throwaway Postgres,
typecheck, lint. Migration announced in `#prova-build` before the push. Nothing
from any of the four real drawings is in the repo.
