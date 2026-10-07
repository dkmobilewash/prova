### The drawing gives up its walls (Diego)
`diego/wall-detection`

A framing/drywall estimator traces every wall by hand — 150–300 runs on a floor
plan, hours per sheet, the single largest time sink in estimating.

`lib/takeoff/wallVectors.ts` has been able to find them since #649 — **a wall is
two parallel lines a wall-thickness apart, and on a CAD sheet those lines are
already in the file** — and **nothing in the product called it.** The written,
documented and never called shape, deliberately: it was built to answer whether
this can be deterministic. It can. This wires it up.

## Phase 0 first: measured on real CAD before a pixel of UI

`wallCases.ts` says its own cases are drawn by our generator and *"a pass here is
a FLOOR"*. There was no real-sheet arm. So the finder was run against 7 real
sheets from 3 projects before anything was built:

| sheet | segments | after filter | walls | feet | ms |
| --- | --- | --- | --- | --- | --- |
| Augusta A1.11 | 23,351 | 1,623 | 143 | 859 | 81 |
| SCHD VA A102 | — | — | 542 | 3,211 | ~400 |
| Salina p19 | 112,547 | 4,660 | 203 | 1,653 | 577 |
| Salina p31 | 116,893 | 7,998 | 511 | 4,503 | 1,668 |

**The strongest evidence it is real:** the biggest clusters land on dimensions
walls are actually built at — **4.88", 4.92", 4.80" on three unrelated
projects**, every one of them a 4-7/8" partition, which is a 3-5/8" stud with
5/8" board each side. Noise does not land on 4-7/8".

**What Phase 0 changed:** the design assumed three clean thickness groups. Real
sheets return **15–21**, with the top three holding only about half the footage.
Showing three and calling it the answer would hide footage an estimator is going
to bid. So the panel sorts by FEET, shows the biggest six, and counts the rest
honestly. The promise is smaller and true: **the biggest wall types come for
free** — accepting one group on one real sheet replaced ninety-nine hand traces.

**Two harness bugs were caught before any number was believed.** `feetPerInch`
does not exist on `PrintedScaleReading`; typecheck said so, and the NaN it
produced filtered every segment away and read as a sheet with no long lines on
it. A control that fails is the instruction to fix the harness, not a result.

## Making it runnable, which is not an optimisation

`wallsFromStrokes` is O(n²) with `inAHatchSeries` scanning inside it. At 116,893
segments that is ~10¹⁰ operations — not slow, *never*. `minLengthFeet` was
already applied per PAIR; it is now applied to the INPUT first.

**Provably safe, not a heuristic:** a wall's length is the overlap of its two
faces, which is at most the shorter face, so a face below the minimum cannot
belong to a wall above it. Exactly the same walls come back — and that claim is
mutation-tested: **removing the filter leaves every test GREEN**, which is the
result that proves it.

## No ground truth, and it is not pretended away

Nobody can say how many walls are really on these sheets, so **missed and phantom
counts are absent rather than estimated.** Thick clusters (15–16") are 5–9% of
footage on four sheets and look like two parallel walls across a closet paired as
one — a known failure mode. The 18" ceiling is unchanged on Diego's call: showing
a questionable wall an estimator can reject beats silently dropping a real one.

## What it does, and what it does not touch

**"Find the walls"** on the toolbar, enabled only once the sheet is calibrated —
structural, not tidy: the finder's bounds are in feet of building, so without a
scale every bound means nothing. Detection runs **in the browser**, against the
pdf.js document the viewer already holds open: no upload, no round trip, no
stored proposals, **no new table, no migration, no model call, no spend.**

Groups are drawn **on the sheet**, each in its own colour. That is the
verification channel and the whole safety argument: the finder returns
centrelines rather than a number, so a wrong answer is a line sitting where there
is no wall, which a person catches in a glance.

**Accepting a group writes ordinary LINEAR measurements.** Everything downstream
— the measurement list, the wall type, the height, `postMeasuredWallRun`, the
priced estimate lines — already works on those and is untouched. Nothing is ever
applied automatically, and hand-tracing is unchanged.

## Verification

- **16 render tests** and 8 pure cluster tests. A render test rather than a
  census because #665 shipped a control gated so it appeared on no screen — every
  assertion a census could make was true while the app was broken.
- **7 dbtests** on a real Postgres: the group lands whole, and **a batch with one
  bad shape writes NOTHING** — a partly-added group is indistinguishable from a
  complete one, so the estimator would bid short with nothing looking wrong.
- **7 mutations, each behaving correctly.** Two are worth naming: the ghosts
  rendering nothing was **GREEN** until they were extracted into their own
  component — found only by mutating, and they are the safety argument. And
  `<FoundWalls/>` deleted from the viewer was green after that, so the pair is
  tested: one asks whether it draws, the other whether it is placed.
- The client/server boundary census caught `inchLabel` exported from a
  `"use client"` module; it lives in the pure wall module now.
- Four gates: **9,303 unit tests, 687 db tests**, typecheck, lint.

## Click-list

1. Open a calibrated floor-plan sheet. *Expected: **Find the walls** on the
   toolbar. On an uncalibrated sheet it is absent.*
2. Press it. *Expected: within a second or two, dashed coloured lines over the
   drawing and a panel listing groups by thickness, biggest footage first.*
3. **Look at the lines.** *Expected: they sit on real walls. This is the check
   that matters — if they are in the wrong place, say so and do not add them.*
4. Hover a group. *Expected: its lines thicken and the others fade.*
5. Press **Add these** on the biggest group. *Expected: it leaves the list, the
   others stay, and the measurements appear in the list below labelled with the
   thickness.*
6. Select them there, pick a wall type and height, post. *Expected: they arrive
   PRICED, exactly as a hand-traced run does.*

## The bound

Seven sheets from three projects is not "it works on real CAD" — they are all US
commercial architectural exports, and the finder has a recorded hard limit: a
sheet whose lettering is saved as line work (Colton) is not something it can
read. More real sheets from different CAD programs is the honest next step.
