### Plan reading reads four pages at once on the model stages

Walk v6's longest wait between sign-up and a sent bid was the title-block read: 124 pages in 189 s, one model call at a time, while the person watched the bar. The open page's slice (`advancePlanIngest`) now runs `MODEL_LANES` (4) workers over the same claim for a stage that spends (title blocks, wall legend, schedule rows). Free stages stay at one lane, since the PDF parse and raster are CPU in-process.

The check: `claim.dbtest.ts` runs four lanes over 12 pages and asserts every page is worked exactly once with four in flight; `readLanes.test.ts` asserts the slice uses the lanes only on a spending stage. Both went red under mutation (lanes forced to 1). The monthly sheet allowance was already an atomic increment under its ceiling, so lanes cannot overspend it.

### One type for every group on a sheet that nothing names

The queue's 13 groups on Baker's A101 that no tag, legend or library type names each took a pick and an Enter (walk v6: 26 of the queue's 49 actions). On such a group the queue now offers "ZA1 on all 13 groups nothing names on A101 (A)": pick the type once, press A or the button, and every one of them takes it, each at its own pre-filled height unless a height was typed. It goes through the same `confirmSheetSuggestions` as Accept all, so the one line that says what went in carries Undo for all of them. Nothing is typed until a person picks the type.

The check: `queueGroupZones.test.tsx` (the button waits for a pick, A gives the picked type at the shown height, not offered with nothing else to type) and `accept-sheet.spec.ts` step 5 (two unnamed groups typed in one press, runs off "Walls — untyped", ZA1 at 15 ft, Undo puts both back).
