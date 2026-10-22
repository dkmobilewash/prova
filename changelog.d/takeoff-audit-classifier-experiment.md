### The classifier experiment: synthetic-only training lost

The cheap experiment the hybrid plan called for, run before buying any labelled
sheets. Everything is behind a switch that is **off**: `WallFinderOptions.decide`
is undefined by default and nothing wires it up.

`wallFeatures.ts` turns a candidate pairing into 20 numbers. `wallVectors.ts`
gained a seam that collects EVERY pair the geometry accepts, not only the ones
the greedy pass awards — measured from inside that loop, the alternatives are
44,012 ft against 1,864 ft of genuinely missing wall, so they are most of what
there is to learn from. `zzExtract.eval.ts` labels them from the bench's own key
by geometry. scikit-learn (BSD-3, CPU, offline) trains 120 gradient-boosted
trees; `wallClassifier.ts` walks the exported JSON in twenty lines, so the
product carries no runtime dependency and nothing leaves the machine.

20,734 candidates, 7 families, leave-one-family-out **AUC 0.991** — and it
loses on every number that is defined: bench phantom footage 3,497 → **7,930
ft**, the zero-wall bar **PASS → FAIL** (5 of 41), fixtures 15 of 17 → **13**,
Cedar Hollow missing 5.07 → **8.87 ft**, ELEVEN03 A4.B-Y2 **+47%**.

**AUC 0.991 while doubling the phantom footage** is the lesson: a per-candidate
score says nothing about a sheet, because the errors concentrate in long runs
and a sheet is judged in feet.

Two faults, both readable in the model file. `nearestScheduledDeltaIn` takes 196
of the tree splits and 0.52 of the importance, ranges 0–2.81 in training and is
never −1 — so on a sheet with no wall schedule every candidate gets a sentinel
below every threshold the model learned, and each tree sends it down the "this
is exactly a scheduled thickness" branch. The out-of-distribution value fails
toward YES. And `inHatchSeries`, true on 23% of training rows, is split on
**zero times**: on the bench thickness alone separates the classes, so the model
never learned hatching, and the overlay of ELEVEN03 shows every poché'd block
filled with red.

The bench cannot be the training set — it has no sheets without a schedule, no
realistic poché and no layer names, so it cannot teach the three things that
actually go wrong. The 40–60 real labelled sheets estimate stands, and this was
the cheap way to find out there is no shortcut round it.

The pipeline is kept because only the training set was wrong, and a parity test
pins the JS evaluator against scikit-learn to six decimals — without it a slip
in the tree walk would score every sheet wrongly and never throw.
