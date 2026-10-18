### A calibration test that answered differently twice (Diego)
`diego/flaky-calibration`

On 2026-10-08 `takeoff-plan.spec.ts:151` failed in CI with *"50 ft over half the
sheet means the sheet reads about 100 ft across; it read 93"*, and passed on a
re-run of the same commit. A test that answers differently twice about identical
code teaches everybody to re-run until green, which is how a suite stops meaning
anything — the mirror of the vacuous green this repo keeps finding, a red that
carries no information.

The spec clicks two points on the sheet and measures their separation. It waited
for `canvas.width > 0` before clicking, which proves pdf.js drew something and
does NOT prove the layout has settled — and the viewer's `zoomFactor` falls back
to 1 until both the page size and the measured frame arrive, only then resolving
to FIT. So the sheet's rendered width can change after the drawing appears, and a
resize between reading the box and clicking lands the click at a different
fraction of the sheet than the one asked for.

Two changes, and they are not equally proven.

**The clicks are now a PAIR measured against one box.** Every use of this helper
was two calls whose SEPARATION is the measurement, and a separation taken against
two different boxes is not a separation. Reading the box once makes that
structural rather than something each call site remembers.

**A resize between the two clicks is now LOUD.** Previously it produced a
quietly wrong number — 93 where 100 was expected, with nothing to say why. The
pair now re-reads the box afterwards and fails naming the two widths. This half
is proven: mutated to an impossible threshold it fails and reports its own cause,
so it runs on every pass rather than being decoration.

**The wait for a settled size is NOT proven**, and the comment in the file says
so. The flake did not reproduce locally across repeated runs, and instrumenting
the loop showed it returning on its minimum three polls every time with the width
already steady at 358px — locally it waits for nothing. It is kept because the
condition it guards is real in the viewer's code and was observed in CI, not
because it has been shown to fire. A cheap wait against a race nobody can
reproduce is a reasonable hedge; implying it is a diagnosis would not be.

So the honest claim is narrow: this does not prove the flake is gone. It
guarantees that the next time the sheet moves mid-measurement, the suite says
which two widths disagreed instead of handing somebody a seven-foot error with
no explanation.
