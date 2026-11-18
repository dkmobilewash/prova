### The second copy of the biggest-view sort gets #1183's area fix, and a multi-scale sheet says so out loud (Diego)
`diego/sheets-for-set-area`

#1183 changed the per-view scale fallback from "widest view" to "biggest view by AREA" after Mack p9 calibrated an answer-key sheet from a VCT floor-pattern strip — but the fix landed only in `set-review-scales.mjs`, and `sheets-for-set.mjs` carries the same logic. The unfixed copy struck on 2026-11-18: Mid-City A4.0 (p63) was calibrated from the ROOF plan's 1/16" caption while the Building "A" floor plan prints 3/32", so a printed 122'-11 1/2" dimension measured 186 ft — factor 1.5 — and Chrome correctly refused to key the sheet. This is CLAUDE.md's "nothing is ever missing from a list nobody imports" shape wearing a script: the fix was complete in one file and the second file kept the bug.

Both copies now sort by area. And because area cannot save a sheet whose biggest drawing is the wrong one (Mid-City's roof view out-areas its floor plan), the script now prints a WARNING naming every view and scale whenever the views disagree, telling the operator to use the workspace's own per-view scale flow for the drawing being keyed instead of trusting the auto-calibration.

Check: `node --check` on the script; the Mid-City case and the wrong calibration row's values are recorded in coordination/log.md (the row's removal awaits Diego — one delete on prova_dev), and the per-view heuristic question is handed to the scale owner.
