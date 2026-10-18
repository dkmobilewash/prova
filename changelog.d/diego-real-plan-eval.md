### The real-plan evaluation, and what five real sheets say

`reports/takeoff-bench` grades the finder at 83% on Mesa Ridge and 97% on a
20-plan holdout, and **both are drawn by our own generator.** `wallCases.ts` says
so in its own header — *"a pass here is a FLOOR"*. Diego asked the right
question: will this ever work unattended on any set of plans? This is the first
measurement from sheets nobody here drew.

    REAL_PLAN_PDF="/path/to/a real set.pdf" REAL_PLAN_PAGES=1,2,4 \
      pnpm --filter @prova/web exec vitest run \
      --config vitest.eval.config.mts lib/takeoff/realplan

Production path end to end — `segmentsFromOpenPage` → `scaleFromDimensions` →
`wallsFromBothEngines` — with a wall clock on each stage and an SVG overlay for
grading by eye. There is no answer key, which is the point: a wall in the wrong
place is visible on the drawing.

**The confidentiality rule shapes the design.** Customer plan sets are
confidential and real files are never fixtures here, so the path comes from the
environment, nothing is committed, the overlay is written outside the repo, and
the output is metadata only — counts, feet, milliseconds, thicknesses. No text
from the sheet, no sheet or room names.

### Five sheets, two real sets

| sheet | segments | text items | dimensions read | automatic scale |
| --- | --- | --- | --- | --- |
| Modesto p1 | 128,640 | 15 | 0 | **none** |
| Modesto p2 | 108,028 | 15 | 0 | **none** |
| Modesto p4 | 60,757 | 13 | 0 | **none** |
| UT Austin p3 | 153,008 | 702 | 25 | **none** |
| UT Austin p4 | 134,694 | 560 | 0 | **none** |

**Nought for five.** Three sheets have no readable dimension text at all —
their lettering is saved as line work, which `scaleFromDimensions` reports in
those words. The one sheet with 25 readable dimensions was refused for the right
reason: they imply **two different scales** on one page, a plan with details
beside it, which is ordinary in a real set.

The refusals are correct. The detector is not broken; it is saying *set it by
hand*, which the product has always supported.

### With the scale set by hand, on a real sheet

Modesto p4, 60,757 segments, at 1/8" = 1'-0":

```
walls         243 in 4,483ms
linear feet   3,014
thicknesses   6.00" x15 (1,177ft)  8.00" x18 (302ft)  10.13" x15 (167ft)
              5.13" x8 (114ft)     12.00" x5 (83ft)   2.75" x3 (78ft)
              8.50" x8 (68ft)      6.75" x10 (58ft)
```

Two things in that, and the second matters more than the first.

**It is tractable.** 4.5 seconds on a sheet eight times the size of anything on
the bench. The length filter does the work the O(n²) loop could not.

**The thickness spread is a scatter, not a schedule.** 10.13", 8.50", 6.75",
5.13", 2.75" are not partition types anybody builds — because that run passed
the finder **no thicknesses at all**, and the schedule is what the last two days
of accuracy work rests on.

**That is this harness's own doing and not the product's, and the first draft of
this entry said the opposite.** It claimed "nothing extracts a partition
schedule from a real sheet". False: `SCHEDULE_ROWS` in `lib/plan-ingest/`
extracts the table off a schedule sheet, `wallTypesFromSchedule` turns accepted
rows into wall types, and `TakeoffPlanViewer` passes those thicknesses into the
finder. The reader exists and the chain is joined.

What the run actually measured is the **empty-library case** — a sub's first
upload, before any wall type exists — which is worth measuring and is not the
production path. `REAL_PLAN_SCHEDULE_IN` now supplies a schedule so the other
case can be measured too. Flattering a tool by grading its own drawings and
understating it by withholding its inputs are the same error twice; the bench
does the first and the first draft of this did the second.

### And with a schedule supplied, almost nothing changes

Same sheet, same hand-set scale, seven plausible partition thicknesses passed in:

```
no schedule   243 walls  3,014 ft   6.00" 8.00" 10.13" 5.13" 12.00" 2.75" 8.50" 6.75"
7 thicknesses 251 walls  3,035 ft   6.00" 8.00" 10.13" 5.13" 12.00" 2.75" 8.50" 8.13"
```

Eight walls and 21 feet of difference, and **the scatter survives intact** —
10.13", 8.50", 2.75" and 12.00" are all still there in quantity.

**That is the finding, and it is bigger than either missing-link above.** The
schedule is a PREFERENCE between candidate pairs at one face; it is not a
filter. Nothing rejects a pair whose thickness is on no schedule — the
`bestWall`/`anyWall` fallback tiers emit it when no scheduled pair competes, and
the thickness bounds admit anything from 2.4" to 12".

On a generated sheet that is harmless, because everything shaped like a wall IS
a wall: our drawings contain walls, grid lines, dimensions and hatch, and the
heuristics were tuned against exactly those. A real sheet is full of parallel
line pairs that are door frames, casework, mullions, structural shapes and
section marks — and the finder has no way to say no to any of them.

So the honest state of a real sheet is **~250 proposals, an unknown fraction of
them walls**, and the histogram says that fraction is not close to one. Two days
of accuracy work raised how well it finds walls it is shown; none of it taught
it to refuse things that are not walls, because on our own drawings there was
nothing to refuse.

### Two "written and never called" findings, both upstream of accuracy

- **Nothing builds `DimensionLabel` from a PDF.** `scaleFromDimensions` is
  written, tested and documented; its only callers are its own test and a bench
  probe, both handing it labels they constructed. The step that reads `11' - 0"`
  off a page and turns it into 11 exists nowhere but this harness, which is why
  the automatic scale cannot run on an upload today.
- **The partition-schedule path is NOT missing**, and the first draft of this
  entry said it was. `SCHEDULE_ROWS` reads the table, `wallTypesFromSchedule`
  turns it into types, the viewer feeds those to the finder. It does depend on
  AI extraction being enabled and on a person accepting the proposal, so it is a
  path with conditions rather than an absent one — and it is worth running
  end to end on a real set, which this harness does not do.

### What the harness refuses to do

`lib/ask/eval/harness.test.ts` caught the first draft: every keyless eval must
skip when it has no input **and prove the input resolved to something**. A path
to a scanned sheet returns no segments, and without that assertion the run would
report "0 segments" and pass — a clean zero, which is the vacuous green this
repo keeps paying for. Registered in `KEYLESS_EVALS` with its reason, and the
segment assertion names the scan case in words.
