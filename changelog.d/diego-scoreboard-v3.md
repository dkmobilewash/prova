### Scoreboard v3: actions to exact, the 2-minute review budget, and heights graded only where the key knows them

The Walls v1.0 Finish Plan (Diego, 2026-11-26) moved the finish line from zero-touch
to "an estimator gets from upload to a near-exact takeoff fast". This is the
instrument for it, pre-registered first in prereg-scoreboard-v3.md, with two
amendments logged before any baseline number: the work-area box counts on every
sheet (the product offers it everywhere; the prereg first said renovation-only),
and Diego ruled "Exclude like this" counts as a move.

- `lib/takeoff/actionsToExact.ts`: the fewest moves (greedy, an upper bound) to turn
  a sheet's draft into its key — boxes, like-clicks, junk removes, real walls a box
  or click sets aside, held real walls restored, missed walls added, one height
  answer per key-known wall type. Pure, so every term is pinned by its own test;
  7/7 term mutations red.
- zzZeroTouch gains ZT2MIN (≤3 boxes + 10 answers + 1 height answer per type,
  criteria 1 and 2), ZTACT (criterion 3) and ZTHGT; board is compared only where the
  key knows the height, with default-vs-default reported on its own line. Zero-touch,
  v2 and ZTCAUSE lines are byte-identical to the Exam 3 true-env run (build gate).
- A dispute dump (posted junk + missed key walls, coordinates only) feeds the blind
  truth audit; `heldOutScore.uncoveredFeet` is exported so v3 shares v2's rule.
- `scripts/exam-runs/sb3-baseline.sh`: the committed baseline run, refusing unless the
  snapshot's hash is the post-44b cut's.
