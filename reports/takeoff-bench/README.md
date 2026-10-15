# Takeoff accuracy bench

An adversarial test bench for plan takeoff, on a **fictional** project. Nothing here came from a real drawing.

    TAKEOFF_BENCH=1 pnpm takeoff:bench      # ~10 seconds; rewrites this folder

| File | What it is |
| --- | --- |
| `SUMMARY.md` | Plain-English findings for a non-estimator, with the 5 most expensive bugs. Written by a person from the numbers below. |
| `SCORECARD.md` | Pass bar, mechanism probes, one row per case (worst first), findings per case, LF by type, materials, schedules, addendum, and the thresholds each case targets. |
| `HOLDOUT.md` | The 20 seeded random plans, run once, reported separately. |
| `walls.csv`, `holdout-walls.csv` | One row per wall per case: centreline, face-overlap and net lengths, what was found, error % by both conventions, and the diagnosis of every miss. |
| `overlays/*.png` | Each case's real PDF rendered by pdfjs, with the answer key in blue, true finds in green, phantoms in red, must-not-count in orange, and CMU/storefront in purple. |
| `fixtures/pdf/` | Every PDF graded: the raw writer's variants, the Chromium/Skia exports and the holdout sheets. |
| `fixtures/keys/` | The answer key per case (JSON), computed from the model and never from the PDF. |
| `fixtures/dxf/` | Every sheet as DXF R12 in paper inches at 1:1. Open it in AutoCAD, BricsCAD or DraftSight and plot it to PDF. That is the true CAD export for the next round. |
| `results.json` | Everything above, machine-readable. |

The source is `apps/web/lib/takeoff/bench/`. `model.ts` is the single source of truth. `sheets.ts` turns it into sheets, `writers.ts` into files, and `cases.ts` defines the variants and the answer key. `harness.ts` calls the product's own pipeline and grades it. `probes.ts` isolates one heuristic per probe. `HEURISTICS.md` lists every threshold and which case targets it.

## Conventions, and why

- **Wall length, two conventions.** An estimator measures the CENTRELINE, junction centre to junction centre. A pair-finder can only see where BOTH faces are drawn: junction cleanup and openings take that away. Every wall carries both numbers (`key_cl_ft`, `key_face_ft`) and every error is reported against both. The pass bar uses centreline, because that is what goes on the bid.
- **Gross and net.** `key_net_ft` is centreline minus every opening width. Found runs stop at door jambs, so what the finder returns is close to net.
- **Openings in board area.** The app's rule deducts an opening only at ≥ 32 SF; an estimator's hand count deducts all of them. Both are computed; the gap is shop convention, not a bug.
- **Enlarged plans, RCPs and mechanical backgrounds** show walls that are already on the floor plan. On A-401 they are graded for detection but are not bid quantities. On A-111 and M-101 they are graded as DUPLICATE, which counts against the zero-wall bar: accepting them would double a floor.
- **The F1 furring** sits on CMU. A pair made of the furring face and the far side of the block lands on the CMU, so it is graded as out-of-scope rather than as a found furring wall.
- **The grid is A–H × 1–4**, not 1–9: A–H × 1–9 at 30' bays is 50,400 SF a floor, which contradicts the 38,000 SF brief. See `model.ts`.

## The rule for fixes

Tune on Mesa Ridge. **Validate on the holdout.** A threshold moved until `SCORECARD.md` passes proves only that it passes Mesa Ridge. Product fixes belong in their own PRs; this folder only measures.
