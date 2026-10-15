### The drawing says which lines are walls, and nothing was reading it

Reported from a real dealership bid set with pictures: the letters of the
architect's **logo** came back as walls, and so did the **cars** on the parking
plan. Both are the pairer answering correctly — an "S" really is two parallel
strokes a wall-thickness apart, and a car body really is two parallel lines
eight inches apart. Every filter in the wall finder measures a stroke's SHAPE,
and the difference here is not a shape.

It is in the file. A CAD export made with layer information wraps every stroke
in an optional-content group named after the layer: `A-WALL`, `S-GRID`,
`A-FURN`, `G-ANNO-TTLB`. `sheetStrokes.ts` now reads those names,
`layerNames.ts` judges them, and `findWallsOnSheet` drops the strokes that are
confidently not walls before any geometry is measured.

Three rules make it safe rather than clever, and they are the whole design:

- **`unknown` is kept.** `sheetTemplate.ts` states the doctrine — *"cannot tell"
  must not mean "drop it"* — and the asymmetry is the reason: a phantom wall is
  on screen and a person rejects it in a second; a missing wall is invisible and
  reaches a bid. `0`, `Layer1` and `MYSTERY` keep everything they carry.
- **A sheet with no layers is untouched**, byte-identical to before. That is
  most sheets, and it is why this was safe to ship before anyone had proved a
  real set carries layers.
- **It refuses to empty a sheet.** If a house style ever named its partitions
  something this vocabulary reads as furniture, the filter would delete the
  whole takeoff and the screen would say "No walls found" — a sentence it
  already says honestly for a scan, so nobody would think to look at layer
  names. When the filter would drop everything, it drops nothing. Probe P18.

Nothing is dropped silently: the panel names the layers and separates the
arguable drop (`EXISTING`/`DEMO`, which a remodel might be pricing) from the
obvious one.

**`A-WALL-DEMO` is out-of-scope and NOT a wall**, even though the name contains
`WALL`. Reading it the other way prices a demolition as new construction, which
is the most expensive single mistake available on this screen. It is also the
third thing the report asked for — *"it says existing space so those would not
need to be accounted for"*.

### What it bought on the bench: nothing, and that is the honest headline

A new `layers` export variant was added — every stroke on its own named layer,
which is what "Export to PDF with layer information" actually produces — and run
on **every** sheet rather than only the floor plan, so the filter would be
graded where it could lose as well as where it could win.

**On every sheet, `layers` reads identically to `clean`.** The filter removes a
third of the line work on a ceiling plan and the footage does not move.

The reason is worth more than the result. The bench's biggest phantom numbers —
A-111 at 2,314 ft and M-101 at 2,268 ft — are **real walls on a layer named
`A-WALL`**. Probed directly: A-111 carries 478 path operators on `A-WALL`, and
`sheetSuitability.ts` already explained why in its own header — *"an M-101
carries the architectural walls repeated in grey as background… they are also
the same walls as the A-101, so counting them bids the job twice."* That is a
sheet-type double count, not a misidentification, and no layer filter can touch
it. The plan this work came from asserted those ~20,400 ft as the prize for
layer reading. **That was wrong**, and the right fix for them is the
suitability warning that already exists and is blind because those plan sets
predate the ingest.

So the bench cannot show what this filter is for, and `realPlan.eval.ts` already
says why: *"a pass here is a FLOOR"*. The logo and the cars survived every
geometric filter on a real sheet and no bench fixture reproduces them. P17
demonstrates the mechanism directly — three identical wall shapes on `A-FURN`,
`G-ANNO-TTLB` and `A-WALL` return **20 ft with layers and 60 ft without**.

### And then it found a real bug, which is the part that actually moves numbers

Grading the new variant turned up one wall missing from it — LB-30, a 10 ft
partition. The control said the layer filter was not responsible: **with the
filter disabled, the wall was still gone.**

`pdfjs` buffers path operators and flushes on its own schedule. When a flush
lands between a path's `m` and its `l`, one path arrives as two `constructPath`
operators. The reader started each operator with a null cursor, so the moveTo
drew nothing (it is only a move) and the lineTo drew nothing (it had no cursor
to draw from). **The line vanished with nothing thrown.** From the operator list:

```
2996 setDash        [[],0]
2997 constructPath  ops=[13] coords=[248.9 918.4]     <- the m
2998 constructPath  ops=[14] coords=[326.9 963.4]     <- the l
2999 stroke
```

**The trigger is not the layers.** There is no marked-content operator between
2997 and 2998; the markers merely shifted everything along until a flush
boundary landed mid-path. This is a latent fault in reading ANY sufficiently
large PDF — it simply had never been visible, because the untagged fixtures
happen not to hit a boundary mid-path. A real CAD export is bigger and more
interrupted than anything in this bench.

The pen position now carries across `constructPath` boundaries, which is what
the PDF model says anyway: `m` and `l` build a path until a PAINT operator ends
it, and how a parser chunks the operators in between is its own business.

### The three numbers, on the 60 cases that existed before

| | before | after | |
| --- | ---: | ---: | --- |
| footage **found** | 48,788 | 48,881 | **+93** |
| footage **not on a wall** | 22,752 | 22,791 | +39 |
| walls **missed** | 122 | 120 | **−2** |
| holdout found | 31,890 | 31,913 | **+23**, wrong-but-confident scales still 0 |

Every case that moved is explained by the split-path fix; not one is a `layers`
case. The +39 not-on-a-wall is **29 ft of it on M-101**, where recovered
geometry is background wall that was already double-counted, and 10 ft across
two A-101 variants.

**Stated plainly: this half fails the gate as that gate was written.** The rule
was *"ship only if found footage did not fall and not-on-a-wall footage did"*,
and not-on-a-wall rose. That rule was written for a FILTER, which only removes;
what landed is a READER FIX, which only recovers. For a reader fix the
defensible bar is found up and missed down, and both hold. The gate is being
read, not quietly reinterpreted — if the +39 is judged too expensive, the
split-path fix is separable from the layer filter.

Probe **P8 now passes** for the first time: a wall on a layer the drawing has
switched OFF returns 0 segments instead of 2. The answer key has been failing it
since it was written.

### One claim I could not prove, left in the open

The holdout names `S-GRID` — a column gridline — as its most common cause of
MISSED footage, through `inAHatchSeries` vetoing a real pair. Dropping gridlines
by layer should recover that footage. **It is unproven.** Two constructions were
tried, including a line at exactly the whole-number pitch the series test
requires, and both arms returned 20.0 ft: on inputs that simple the geometric
filters already cope. P16 therefore asserts only what it can see — the line
never reaches the pairer — and says in its own text which half is unproven,
rather than being reshaped until it flattered the change.

### Verified

- **9 of 9 mutations red**, control green — including `layer` not carried
  through `inPageWidthUnits` (the `curved` bug, reproduced on purpose) and the
  pen position reset per operator (the split-path bug).
- The **first** mutation run had **five survivors**. Each was a test owed, and
  each is written: hidden layers, the layer stamped on a segment, the verdict
  ORDER (every existing case passed whichever way round the checks ran), the
  split path, and the filter's output actually reaching the detector.
- `strokeFieldsCensus.test.ts` asserts the CLASS rather than the instance: every
  field of `StrokeSegment` survives `inPageWidthUnits`, derived from
  `Required<StrokeSegment>` so a field added tomorrow is covered without editing
  the test. `curved` was lost there once; `layer` would have been the second.
- Two fixtures had to be fixed before their results could be read. The
  split-path test's first construction did not reproduce the split at 200, 500
  or 1,000 paths, and its control said so; it is pinned on the real A-101 sheet
  instead. The pipeline test's first fixture had three walls, below
  `wallsInTheBuilding`'s floor, and its control read zero.
- `./scripts/preflight.sh` green, 11,147 tests. No schema change, no migration.

### Noticed, not fixed

**`sheetStrokes.ts`'s rectangle branch shadows the pen width.** `const [x, y, w,
hh]` rebinds `w` from the scaled line width to the rectangle's width, so all
four sides report the rectangle's width as their stroke width. Harmless today —
`HEURISTICS.md` records that nothing in the shipped pipeline has read the pen
since #671, which is why nothing caught it — and a landmine for whoever decides
the pen discriminates a wall from a slab joint. Commented in place, not fixed,
because it would move bench numbers inside a change whose point is a clean
before/after.

`HEURISTICS.md`'s *Read strokes* row claimed `curveTo` is skipped and
`paintFormXObjectBegin` is unhandled. Both were fixed long ago and the row was
not. Corrected here because this change rewrites that exact row.
