## Takeoff

### A scanned sheet gives up its lines

Three of the twenty fixtures are scans — zero strokes, zero text — and the
pipeline refused them honestly because there was nothing in the file to read.
That is not a fixture quirk: of eleven plan sets on this machine **five carry
image-only pages and one is scanned end to end**.

`rasterStrokes.ts` renders the page and finds the lines in the pixels. It
returns ordinary `StrokeSegment`s in the same viewport space `sheetStrokes`
produces from a vector page, so the scale vote, the wall pairer and the room
tracer all work on a scan without knowing it is one. Geometry stays in code;
no model sees a coordinate.

**The grading needed no new ground truth, which is the part worth copying.**
Each scanned fixture is a raster of a VECTOR fixture already in the repo and
says so in its own title block — S18 of S02, S19 of S08, S20 of S13, titles
matching the keys exactly. So the vector drawing's own strokes are the answer
key, and nobody has to decide what a wall is to read the number.

| | wall footage, raster against the same drawing's vectors |
| --- | --- |
| S19 / S08 | 347 ft of 406 — **85%** |
| S20 / S13 | 505 ft of 555 — **91%** |

**One decision is worth most of that, and the obvious version of it scored
5%.** Reporting a band's CENTRELINE reads as right and is wrong: a vector
drawing gives a wall two lines, one per face, and `findWallsOnSheet` builds a
wall by PAIRING parallel faces — so a lone centreline pairs with nothing and
becomes no wall at all. The scanned office suite returned **31 feet against
the drawing's 555** that way. Emitting the band's two faces instead took it to
505. A hairline still emits one line, or the pairer would be handed an
invented partner and annotation would become walls.

**8 of 8 mutations red.** Four survived the first run and each was a real gap,
including one that is this repo's favourite shape: the unseen-ink figure was
asserted only with `toBeLessThan(0.1)`, **which a saturated zero satisfies** —
so the broken version that could only ever return zero stayed green. It is
pinned from both sides now, on a page that is half diagonal.

Three other things the tests caught rather than the author:

- the run floor was 6pt on the reasoning that lettering is never solid ink.
  True across a word, false DOWN a letter: 9pt text has solid 9pt stems, and
  forty hand-drawn letters came back as eighty segments. 14pt clears
  lettering; display type still survives and is pinned as a known limitation
  rather than tuned away;
- a scan's dropout splits one run into fragments — the speckled fixture gave
  953 segments against 336 real lines. Runs bridge 1.5pt of blank paper, and
  no more, because bridging a real gap paves over a doorway;
- the unseen-ink figure was summing band areas, which double-counts every
  crossing on a floor plan, so it read 0% on all three scans.

**What is not built**: a scan has no text layer, so nothing reads its printed
scale or its room names. The eval borrows the vector original's scale to keep
that question out of this measurement. And the three scans are clean
rasterisations — light speckle, no skew — so this is evidence about the
image-only pages we have actually seen and not about a photocopied fax.
