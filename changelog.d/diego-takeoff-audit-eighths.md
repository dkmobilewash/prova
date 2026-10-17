### One thickness, shown and matched

A detected group's thickness is a float — the detector reads 4.33333277" where
the drafter drew a 4-3/8" wall. The panel rounded that to the nearest eighth to
draw its label, and the matcher compared the RAW value with an eighth-inch
tolerance either side. Both numbers were right and they could disagree: the row
could read `4-3/8"` while a `4-1/4"` condition took the group, with nothing on
screen to explain it.

Now there is one rounding (`toEighth`), and the label, the match and the label
posted onto the priced line all use it. The precise measurement is still what
gets stored, and it is on hover — rounding is a presentation choice an
estimator can see past, not a loss.

**The old tolerance is gone rather than left unused.** A named
`THICKNESS_INCHES` sitting in that file is an invitation to reintroduce a
second answer. `duplicateCoverage.ts` keeps its half-inch band and should: that
asks whether two measurements describe the same piece of building, where the
numbers come from different engines and are expected to disagree a little. This
asks whether a measured wall is the condition somebody typed in.

What changed in behaviour: a group measured at 6-1/8" no longer matches a 6"
condition. It used to, on the tolerance, while displaying `6-1/8"`.

Checked as a property, not as examples: a sweep across measured thicknesses
asserts that every match that happens is one where the group's label and the
condition's label are the same string, and that the sweep matched something.
A census covers the third leg — that the label posted to the estimate is built
by the same function — and both of its mutations fail by name.

Nothing in detection changed, and the three accuracy measures confirm it: real
sheets 2 of 9 measured (unchanged), the twenty fixtures 13 of 17 within 2%
(unchanged), the bench unchanged.
