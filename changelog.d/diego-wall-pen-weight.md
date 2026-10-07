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
