### Three fixes so the next training run is sound

No retraining — there is nothing new to train on. These are the faults the
synthetic-only experiment exposed, fixed before any real labelled sheets are
bought.

**A missing value gets its own column.** `nearestScheduledDeltaIn` took 196 of
the first model's tree splits and 0.52 of its importance, and was −1 whenever
a sheet had no wall schedule. In training it never was — every bench sheet
carries one — so −1 sat below every threshold the model had learned and each
tree sent those candidates down the "this is exactly a scheduled thickness"
branch. The sentinel failed toward YES, and ELEVEN03's A4.B-Y2 came back 47%
over. Four features now carry a `has…` flag beside them (`hasSchedule`,
`hasPenWidths`, `hasNeighbourSpacing`, `hasNearestNeighbour`) and use 0 rather
than −1 when absent, so a tree can split on the flag and ignore the value.
Twenty columns became twenty-four.

**Models are judged in feet.** `scripts/train-wall-model.py` no longer prints
AUC. The first model scored a leave-one-family-out AUC of 0.991 and doubled
the bench's phantom footage — a per-candidate score says nothing about a
sheet, because the errors concentrate in long runs. It reports missing and
extra footage per held-out family, sweeps the decision threshold in feet
(extra footage loses a job, missing footage loses money, and 0.5 is only where
a probability happens to cross), and names any feature the trees never split
on — last time that was `inHatchSeries`, true on 23% of rows and used zero
times, which is how hatching got read as wall.

**The hatch and layer features stay**, and the `has…` flags are deliberately
unused on the bench: every bench sheet has a schedule and pens, so they are
constant there. They exist for sheets where they vary, which is every real one.

`wall-model.json` is deleted rather than left beside a column list it no
longer matches — `deciderFor` refuses it, and a model file that cannot load is
not a fallback, it is a thing the next person has to work out the status of.
The evaluator is now pinned by a two-tree fixture small enough to check by
hand, which tests the walk rather than agreeing with itself.
