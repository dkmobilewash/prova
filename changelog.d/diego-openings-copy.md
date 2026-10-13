### Two of the four openings options did the same thing, and the label promised they didn't

Found by a click-through, not by a test. The form offered four choices and the
fourth read *"Not set — however C Stream does it (openings over 32 sq ft)"* —
which promises its own behaviour, while **"Only the big ones, like a storefront"
IS 32 sq ft.** Identical arithmetic, described as though they differed, on a
setting whose whole job is to be unambiguous about how a bid is taken off.

**The collision is not a bug and must not be "fixed".** Unanswered has to
resolve to 32 sq ft, because that is what every company got before this setting
existed; changing it would move live quantities on existing bids. So it is the
LABEL that was wrong, and the fourth option now says plainly that it matches
another one today. The two remain worth separating for one reason, which is in
the component: choosing an answer **pins** this shop's convention, while leaving
it unanswered **follows** whatever C Stream defaults to. Identical today, and
only one of them stays identical if that default ever moves.

The explanatory paragraph also stopped restating the threshold — it now gives
the fact an estimator can use (a 3′×7′ door is 21 sq ft; a storefront is many
times that) and lets the options speak for themselves.

### The test hole underneath it

`openingDeduction.test.ts` already had *"gives every answer a distinct
threshold, so none is a dead option"* — written for exactly this defect, and
blind to it. It iterates `OPENING_DEDUCTIONS`, the three enum values. **The
form offers four**, because unanswered needs a control of its own, and the
fourth is not in that list. Another turn of this repo's recurring shape:
*nothing is ever missing from a list that does not contain it.*

The collision is now **pinned** — `openingThresholdSqFt(null)` is asserted
EQUAL to `openingThresholdSqFt("LARGE_ONLY")`, so the next person meets it as a
documented fact rather than a surprise — with the screen's own honesty asserted
beside it.

### And one thing that held, pinned because the question was right

The same click-through saw **"Saved."** while its network panel showed a **503**,
and asked whether a genuinely failed write would still claim success. It would
not: the `result.ok` check returns before the success flag is set, and a thrown
(production-redacted) error is caught into a sentence. That ordering is now a
test, because it is the kind of thing a later edit breaks without noticing.

The 503 itself was therefore **not the action** — had that request failed,
`await` would have thrown and the form would have shown its error line, and the
value did persist both times. Cause not established: Vercel reported **zero
runtime errors** for the window, so it is not our code throwing, and the
observability log carries only cold-start lines for that period. Recorded as
unexplained rather than guessed at.
