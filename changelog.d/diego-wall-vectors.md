### The walls were in the file all along (Diego)
`diego/wall-vectors`

Wall takeoff was the last of the nine estimating gaps, and the plan was a
vision eval: rasterise a sheet, ask a model to find the walls, grade it like
`symbolCount.eval.ts` graded symbol counting. Symbol counting had already been
REFUSED on that measurement — 2 confidently-wrong answers in 8 under clutter,
with confidence failing to discriminate — so the expectation was another
refusal.

**The sheet turned out to contain the answer as data.** A CAD-exported PDF
draws a wall as two parallel vector strokes, and `page.getOperatorList()` works
in Node on the `pdfjs-dist` this app already ships. `plan-ingest/planPdf.ts`
records what it measured — `numPages`, `getViewport`, `getTextContent`, and
`page.render()` FAILING for want of a canvas — and says nothing about
`getOperatorList`, so nobody had tried it. Probed:

    operators returned: 9
    by kind: { setLineWidth: 1, constructPath: 4, stroke: 4 }
    constructPath args: [[13, 14], [100, 500, 400, 500], …]   // 13=moveTo 14=lineTo

The coordinates come back exactly as drawn. So this needs no model, no
rasterisation (#641 measured that at 46MB a sheet), and the lengths are the
drawing's own numbers rather than anything estimated.

**That is also why it is safe to ship where symbol counting was not, and the
reason is about checkability rather than accuracy.** A wrong door count reads as
certain and nobody can check it by eye. This returns a CENTRELINE; the app
measures it with the existing `polylineLength` and the sheet's own calibration,
and draws it on the drawing. A wrong answer is a line in the wrong place that an
estimator sees — which is why the grading has no fatal category, deliberately:
"confidently wrong number" is not a failure this shape can have.

**The measurement is a TEST, not a `pnpm eval:…` script.** Symbol counting's
eval runs by hand because every case costs a model call and an API key. This
costs neither, so it runs on every PR forever instead of when somebody
remembers. Seven synthetic sheets, and the first run was a mess worth recording:

| case | before | after |
| --- | --- | --- |
| hatched plan | **230 phantom walls**, 11,584ft claimed of 100ft | 4 found, 0 phantom, 100.0ft |
| detail sheet, no walls | **230 phantom walls** | 0 found, 0 phantom |
| every clean sheet | 1 phantom, 120ft of 100ft | exact |

**Hatching was the real finding, and no tolerance could have fixed it.**
`syntheticSheet.ts` draws poché as parallel diagonals every 6 points — 4.24pt
perpendicular, which at 1/8" scale is 0.47ft, almost exactly a 4-7/8"
partition. Every adjacent pair of hatch strokes is a textbook wall by
thickness, parallelism, overlap and length. CLAUDE.md predicted this one level
up: *"at 44 DPI a hatch line and a door leaf are both one thin stroke."* What
separates them is not the gap but the company they keep — **hatching is a
series, a wall is a pair** — so a pair is rejected when a third parallel stroke
continues the spacing. That is how a person reads it too; nobody measures the
gap, they see the stripes.

The 20ft of phantom on every clean sheet was the SHEET BORDER paired with the
TITLE-BLOCK box: two parallel lines 10pt apart, which is 1.1ft at that scale and
sits squarely in the partition window. Thickness, parallelism and overlap are
all satisfied. Their LENGTHS are not — a 36" border against a 180pt title block
is a 13-fold difference no wall has — so one wall's two faces must now be
within 3× of each other.

**Checks.** Five mutations, each RED and each naming its own offender: series
test removed (229 phantoms), face-length ratio removed (120ft of 100ft),
overlap test removed (a dimension string becomes a wall), thickness window
removed (a corridor becomes one wall), and the EXTRACTOR broken — which fails
the harness's own control (*"no path operators — the pipeline read nothing"*)
rather than reporting a clean zero on a pipeline that read nothing. That last
one is the guard this repo keeps paying for: a sheet with no walls found and a
sheet never read must never look the same.

Final: 29 walls across 7 cases, **0 phantom, 0 missed, 0 length-off**, footage
exact to 0.1ft including the fully cluttered sheets.

**One fixture error, recorded because the test caught it rather than me.**
`two-rooms-shared-wall` asserted 7 walls while calling `room()` twice at a
shared x — which draws its vertical twice, so the sheet carried 8. The case was
testing its own arithmetic instead of the finder; the shared wall is now drawn
once.

**The bound, which is the whole reason this is a measurement and not a
feature.** These strokes are drawn by our own generator, so a pass proves the
PIPELINE — that `getOperatorList` reaches the lines, that the viewport transform
puts them in the right space, that the pair-finder works end to end — and NOT
that a Revit or AutoCAD export looks the same. Same bound `symbolCases.ts`
records about itself. The next step is one sheet exported by real CAD, which
does not need a customer's drawings; a real plan set must never be a fixture.

A scanned sheet has no strokes to read and will say so, the way
`PlanSheetText.hasTextLayer` already does for a title block — no vision
fallback on the worst-quality input, which is where an unverifiable answer
would be least verifiable.

No product code, no UI, no schema, no model call.
