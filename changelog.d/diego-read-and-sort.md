### The title-block read keeps going with you on the page, and notes sheets are not floor plans (new-customer run v2, M6 and M7)

- **M6.** On Baker the title-block read needed "Keep reading" once on every run, after about three slices, with the user still on the page.
  - The slice loop asked "did that slice move?" against the panel's `view` from the closure that started it, which was the finished 65-page inventory.
  - So every title-block slice (0, 1, 2… of 65) looked like standing still, and three of those stop the loop.
  - It now compares each slice with the last one of the same run (`lastSettled`, a ref). The stop for slices that really move nothing (every page in backoff, or another worker) is unchanged.
- **M7.** A301 GENERAL NOTES (A201 on another run) and A601 WALL TAG LEGEND were filed as floor plans. The read calls nearly every architectural sheet a PLAN, and those titles scored 0, so each was another printed-scale press and another sheet the whole-set run took off.
  - `takeoffRank` now demotes a title naming NOTES, LEGEND(S), ABBREVIATIONS or SYMBOLS, but only where it does not name a PLAN. Its worst-match rule would otherwise make "FLOOR PLAN NOTES" a notes sheet.
  - That one rule moves them out of the plan set's floor plans (`sheetCategory`) and out of the whole-set run (`takeoffSheetVerdict`).
- Tests:
  - `planIngestKeepsReading.test.tsx`: a title-block read started after an inventory reads all six pages (3 with the old comparison).
  - `notesSheets.test.ts`: the four titles go to "other" and "not a floor plan", while "FIRST FLOOR PLAN AND NOTES" stays a floor plan.
  - `plan-set-scales.spec.ts` carries an A301 GENERAL NOTES sheet the read calls PLAN.
