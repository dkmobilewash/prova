### A sheet whose drawings print different scales asks which one, in one press

Mid-City A4.0 (p63) carries a roof plan at 1/16" and the Building "A" floor plan at 3/32", and the roof plan is the bigger drawing — so the review scripts' "biggest view" calibration (#1183, #1213) measured every floor-plan wall 1.5 times long, and no size rule could have picked right. Diego's ruling (2026-11-18): such a sheet gets NO automatic calibration.

- The workspace toolbar lists each drawing's printed scale with the drawing it belongs to ("3/32" = 1'-0" · BUILDING "A" FLOOR PLAN"); one press saves that drawing's scale (`saveViewScale`, which reads the view from what ingest stored, never from the browser) and says what it saved, with Undo.
- `set-review-scales.mjs` and `sheets-for-set.mjs` share one rule (`scripts/view-scale-choice.mjs`): the biggest view only when every view prints the same scale; otherwise nothing is written and the sheet is reported as asking. This reverses the Mack p9 biggest-view write.
- Existing calibrations are not touched. On the local dev set, 43 multi-view sheets now ask (2 keyed, both held-out: Mack A-101 p9 and Central Bank A101; no training sheet); all 123 sheets whose views agree pick exactly the view they did before; sheets with one printed scale take none of these paths.

Checks: `multiScaleSheets.test.ts` (the rule, and both scripts using it with no second copy of the sort) and `takeoffToolbarScale.test.tsx` (each scale shown with its drawing, one press saves that one, Undo, the toolbar wiring). Removing the disagreement check, or pointing the press at another action, reds them.
