### The sheet whose walls are on the job is the one the set counts

Chrome round 7. On Baker A100, "It is a wall" changed the sheet's total and said nothing.
Review walls said "not on the job yet", and the whole-set summary listed A100's walls as
counted. Round 6's sentence never showed. On a fresh copy of the real set, the loader
did name A101 for A100, so the code was right there. Chrome's long-lived job was not in
that state: A101's scale had been saved again, and nothing was stored against the new
scale. So the planner, which preferred the sheet with walls against its current scale,
kept A100 and called A101 "same level as A100". That was reproduced on the real set,
with every step running the product's own code.

The planner now prefers the sheet whose walls are on the job (DETECTED measurements, under any
scale), since that is what the estimate counts. A whole-set re-run finds such a sheet again
under its new scale instead of detecting it fresh and refusing to write beside the old rows.
The viewer shows "This sheet isn't counted: A101 shows the same level" on load, beside the
walls total, as well as in the not-walls panel and the review line.

`realplan/bakerNotCounted.dbtest.ts` runs the whole path on the real drawing when BAKER_PDF
names it: the inventory, the walls stage, A100's scale-save find, A101 scaled again, a
re-run, the loader and the summary. It is skipped without the drawing, and removing the
on-the-job preference turns it red at the re-scale step.
