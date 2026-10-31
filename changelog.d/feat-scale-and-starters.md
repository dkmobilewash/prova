### Pick a standard scale; the scale offer appears when reading finishes; starters stay on offer (#818)
`feat/scale-and-starters`

**A standard scale picker in Set scale.** A 30-year sub said the slowest part
of takeoff is odd scales — "architect using 3/16, the measure tools we're using
are 1/8 or quarter, so you need to calculate." The Set-scale form now offers
the architectural (3/32 to 3" = 1'-0") and engineering (1" = 10' to 100')
scales. The list is `STANDARD_SCALES` from `takeoff-plan.ts`, exported rather
than copied, so every offered scale
is one `readScale` can name back; and a pick becomes a line across the sheet
through `calibrationForView`, the function the per-drawing caption offer
already uses, so there is no second scale computation. The check is
`takeoff-scale-picker.test.ts`: every entry, at three sheet sizes, reads back as
itself. The distance is typed as decimal feet because `formatFeetInches`
rounds to the inch, which at 3" = 1'-0" on a tabloid sheet is a third of a
percent. One line says a picked scale is exact only if the PDF is printed at
100%; the printed-dimension path stays first. Pre-selected from the sheet's
reading, title block or single caption, never applied by that.

**The toolbar's "Use scale …" offer no longer needs a reload on a fresh set.**
The sheet-reading panel now calls `router.refresh()` once, when a run it drove
completes — not per slice (that is what lost the estimator's sheet in
September), not on mount, not when the loop stops short. `planIngestRefresh.test.tsx`
pins all five, each by mutation. Found on the way: the slice loop's idle stop
compares against the `view` its closure was created with, which is null on a
fresh start, so a fresh run never stops for idleness. Not fixed here.

**/wall-types keeps offering the starter assemblies while any is missing
(#818).** It was offered only on an empty library. The button now says how
many it adds, the count coming from `missingStarterTypes` — the same rule
`addStarterWallTypes` writes by, so the number on the button is the number the
press writes. A code counts as held case-insensitively (the schedule import's
rule), so a company's own `w3` is not joined by a second `W3`; the action only
creates, never updates. The button also moved outside the empty/list branch,
because the press swaps that branch and was unmounting its own "Added …"
sentence. Both e2e specs that press it now assert the count.
