### The pen says what the geometry cannot (Diego)
`diego/wall-pen-weight`

#668 stopped the wall finder reading the title block. What it could not stop was
noise INSIDE the building: five long lines down an apparatus bay — slab joints or
a trench drain — which genuinely are two parallel lines a wall-thickness apart.
No test of their shape can refuse them, and they are in the building, so position
cannot either.

**CAD draws walls heavy and patterns thin, and that survives the PDF export.**
One real sheet carries 112,547 strokes at a handful of discrete pens:

```
0.24pt × 96,569    0.48pt × 4,742    0.84pt × 4,707    1.44pt × 1,006
4.00pt × 772       1.08pt × 744      0.36pt × 599      2.16pt × 578
```

**86% at 0.24pt** — hatching, text, dimension lines, floor patterns — with the
wall work drawn above it. Colouring the sheet by pen put the building's walls in
the heavy band and the bay joints in the thin one. That picture is the whole
argument, and the bay lines are gone.

## An AI API was considered and is the wrong tool

Checked first, and ruled out cheaply: **these PDFs carry no layers.** AutoCAD and
Revit often export `A-WALL-FULL` as an optional content group, which would make
this trivial. None of the three files has any.

A vision model is worse than what is already here: the geometry is EXACT — the
lengths are the architect's own numbers, not estimates — and `symbolCount.eval.ts`
already refused vision for this class of problem because *a wrong count reads as
certain and a person cannot check it*. Rasterising a 42-inch sheet was measured
at 46MB. The problem was never measuring; it was classifying, and the classifier
was already in the file for free.

## The threshold is the sheet's own

The commonest width on a drawing is whatever that office uses for hatching, so
anything heavier is deliberate line work. Taking the MODE rather than a constant
means a practice that draws everything at half weight still works.

## It finds MORE walls, not fewer

**178 → 230 on the measured sheet.** A thin stroke lying near a wall face could
claim it first — the pairing marks each segment used — so the real partner was
already taken by the time the other face was tried. Removing the thin strokes
stops them stealing partners. The filter runs BEFORE the pairing for that reason.

## Verification

- 7 tests on the filter, plus a new one on the stroke reader: **`Q` restores the
  pen as well as the matrix.** Line width is graphics state, and a reader that
  pops the matrix but not the pen reads everything after a transformed block at
  the inner width — which would silently reclassify the drawing. The generator
  now sets a pen inside its `q … cm … Q` and draws the last wall after the
  restore, the same shape that exists for the matrix and for the same reason.
- **6 mutations, each red.** Four were GREEN first:
  - the viewer dropping the call (the wiring gap every one of these has had),
  - the no-width fallback, whose fixture proved nothing — 20 widthless strokes
    left the heavy band empty either way, so the OTHER fallback caught it,
  - the `Q` restore, which nothing could see until the generator could emit a pen,
  - and a single-weight guard that was **deleted rather than tested**: mutation
    showed it unreachable, since a sheet drawn at one pen has nothing above its
    own mode and the empty-band fallback already catches it. An untested branch
    that cannot fire is the "written, documented and never called" shape.
- One test expectation was wrong and the suite said so: a 3pt pen under a 2×
  matrix reads as **6**, because a width is in user space and scales like
  everything else. Comparing raw pen numbers across blocks would be the same
  mistake the CTM bug made with lengths.
- Four gates: **9,328 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open a floor plan with its scale set and press **Find the walls**.
2. *Expected: nothing on floor patterns, slab joints, tile or hatching. On the
   sheet this was measured against, five long lines down an empty bay are gone.*
3. *Expected: MORE of the real partitions traced than before, not fewer.*
4. **Look before adding.** Anything drawn at a wall's weight that is not a wall
   will still be offered, and the drawing is how you catch it.

## Verified on every readable sheet, and one of them failed

Added after the above, because the same mistake had been made twice: a
conclusion drawn from one sheet's statistics. The shipped pipeline was run over
all seven real floor plans on this machine with a picture saved for each.

| sheet | strokes | heavy | paired | in building | groups, biggest first |
| --- | --- | --- | --- | --- | --- |
| Salina p19 | 112,547 | 15,978 | 248 | **230** (1,678 ft) | 4-7/8"×92 |
| Salina p27 | 80,250 | 16,073 | 98 | **68** (551 ft) | 4-7/8"×14 |
| Salina p31 | 116,893 | 47,061 | 336 | **295** (2,012 ft) | 4-7/8"×124 |
| Salina p32 | 33,571 | 7,248 | 46 | **38** (139 ft) | 4-7/8"×18 |
| Salina p45 | 7,077 | 1,322 | 38 | **0** | — |
| SCHD A102 | 167,911 | 72,753 | 467 | **453** (2,593 ft) | 5"×104 |
| Augusta | 23,351 | 1,306 | 58 | **58** (484 ft) | 4-7/8"×21 |

`4-7/8"` is the biggest group on five of seven — a 3-5/8" stud with 5/8" board
each side, across three unrelated projects.

**p45 was returning the TITLE BLOCK.** It is a sparse sheet that yields almost no
wall, so "the biggest group" was a rectangle in the corner — four runs, 64ft,
offered to an estimator as the walls of a building. The numbers looked
unremarkable; only the picture showed it.

**A building is not a box.** Real plans here returned 38, 58, 68, 230, 295 and
453 runs, so the gap between a box and a plan is an order of magnitude rather
than a margin. Below ten runs it now returns nothing, and the panel's existing
*"No walls found on this sheet. That is a fact about the drawing, not a failure"*
is the honest answer for a roof plan.

Four of the pre-existing tests then went red: their fixtures were two- and
four-run "buildings", smaller than the title block they were written to reject.
Grown to plan size, with each test's point preserved. **The fixture has now been
wrong twice in this file and the code neither time.**

## What the pictures show, stated plainly

**Precision is high, recall is partial.** On Augusta every red line sits on a real
partition — and perhaps 40% of the partitions have one. On SCHD the coverage is
far better. That is the right trade for a tool whose output a person checks on
the drawing: what it offers can be trusted, and what it misses is still traced by
hand.
