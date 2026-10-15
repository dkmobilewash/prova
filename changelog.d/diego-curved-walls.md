### A curved wall is a wall (Diego)

`diego/curved-walls`

Reported from School-01's lobby, 2026-10-11: a curved wall with no overlay on
it at all. **Find the walls** had never seen it, and the reason was written down
in `sheetStrokes.ts`:

> **CURVES AND RECTANGLES ARE DELIBERATELY DROPPED.** `curveTo` is an arc — a
> door swing, **a radius wall**, a pipe… approximating a Bézier as a chord would
> invent a length nobody drew.

That is true of a CHORD and it is the wrong conclusion. The comment names a
radius wall among the things it was discarding.

#### What is actually on that sheet

The curve operators separate cleanly, measured rather than assumed:

| | count | chord |
| --- | --- | --- |
| **the lobby wall — two concentric faces** | **2** single Béziers | **22.2 ft and 21.8 ft** |
| door swings | 35 single Béziers | 4.2 ft |
| hardware circles | 57 runs of 4 Béziers | small, closed |

#### Cut by flatness, which sorts a wall from a door swing for free

`flattenCubic` subdivides until the polyline is within **0.5 pt** of the true
curve — about 2/3 of an inch of building at 1/8" = 1'-0", an order of magnitude
under the thinnest wall this app recognises, so the thickness between two
concentric faces is unchanged by it.

A tolerance rather than a piece count is what makes it self-sorting. Pieces
needed go as the square root of the curve's sagitta over the tolerance, so on
A-101:

- the lobby wall, shallow → pieces about **2.8 ft**, ABOVE the pairer's 2 ft floor
- a door swing, 90° → pieces about **1.0 ft**, BELOW it and dropped

Not a rule naming door swings, and not relied on blindly either: a lone swing
has no concentric partner for the pairer to match it against.

#### The double count, and why no existing dedup could catch it

Flattening alone made the sheet **worse**. Both engines are handed the same
segments and make different-sized runs out of an arc:

| engine | pieces | step | total | thickness |
| --- | --- | --- | --- | --- |
| pairer | 9 × 2.5 ft | 7° | 22.8 ft | **4-7/8"** — A1, correct |
| rooms | 4 × 5.6 ft | 15° | 22.4 ft | 3-3/4" — not in the schedule |

One wall of about 23 ft, billed at 45. Neither `mergeWalls` nor
`oneWallPerPlace` collapses them, and **neither is broken**: both ask whether
two findings are parallel within about 3°, and consecutive pieces of an arc are
not. Every dedup in this module assumes a wall is straight.

So the pairer owns curves — `StrokeSegment.curved` marks the pieces and the room
engine skips them. That is not a coin toss settled by convenience: the pairer
measures face-to-face, which is what gives the arc its correct 4-7/8", while the
room engine reasons about enclosed REGIONS whose geometry a chord approximation
distorts. **The cost, stated:** a curved wall drawn as fill with no two faces
stays missed, exactly as a straight poché wall does today.

#### Graded against the answer key

A-101, whose key reads *48 walls, 2,165 ft centreline (1,894 ft face)*:

| | runs | ft | of the key |
| --- | --- | --- | --- |
| before | 63 | 1,879 | 99.2% |
| flattened, double counted | 74 | 1,957 | 103.3% |
| **flattened, pairer owns curves** | **72** | **1,902** | **100.4%** |

The nine new runs are the arc, at 4-7/8".

#### Checks

Preflight green, 10,076 tests, no migration. **Seven mutations, seven red** —
and the first one is the lesson: disabling the curve branch entirely, which is
the defect exactly as reported, stayed GREEN against the pure-function tests and
all three censuses. A function nothing calls is the shape CLAUDE.md names and
this had it. It is covered now by driving `segmentsFromOpenPage` with a stubbed
operator list — the seam takes an open page and the pdfjs module, so it needs no
PDF, no fixture and no bytes.
