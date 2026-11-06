### Plan reading reads four pages at once on the model stages

Walk v6's longest wait between sign-up and a sent bid was the title-block read: 124 pages in 189 s, one model call at a time, while the person watched the bar. The open page's slice (`advancePlanIngest`) now runs `MODEL_LANES` (4) workers over the same claim for a stage that spends (title blocks, wall legend, schedule rows). Free stages stay at one lane, since the PDF parse and raster are CPU in-process.

The check: `claim.dbtest.ts` runs four lanes over 12 pages and asserts every page is worked exactly once with four in flight; `readLanes.test.ts` asserts the slice uses the lanes only on a spending stage. Both went red under mutation (lanes forced to 1). The monthly sheet allowance was already an atomic increment under its ceiling, so lanes cannot overspend it.
