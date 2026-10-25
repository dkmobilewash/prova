### A plan read whose sheets are all backing off now stops asking, from a fresh start too (Cyrus)
`claude/great-tesla-uex8pv`

`PlanIngestPanel`'s idle guard (three slices that move nothing, then stop)
never fired on a FRESH start. `pump` compared each slice against the `view`
state from the closure it was created in, and its `setTimeout` recursion
re-calls that same closure. On the auto-start and on all four start buttons
that `view` was `null`, so `!view` counted every slice as "moved". A run
whose remaining pages were all waiting out their backoff asked
`advancePlanIngest` every 400ms for as long as the tab stayed open. On a
stage change, the comparison was against the PREVIOUS stage's view instead.
"Keep reading" worked, because its closure's `view` is non-null, and that
was the only path anybody had checked.

`pump` now takes the view to compare against as an argument: each caller
passes the view the run starts from, and each slice passes on its own.
`components/planIngestIdle.test.tsx` holds three cases: a fresh start with
no progress stops after three asks; the same from "Keep reading" (the
control that always passed); and a run that progresses is not cut short.
Mutation-checked by restoring the old comparison: the fresh-start case
fails with "expected 3 calls, got 26" over ten seconds, and the
"Keep reading" case stays green, matching the original report.
