### The one input the feature is FOR was the one input untested (Cyrus)
`cyrus/sales-signals`

Every db case in this file imported one to three rows. The cap is 60, a real award packet for
a large school job carries that many subcontractors, and the whole premise is that somebody
pastes a **whole listing** — so the maximum legal input had never been run against a database.
Added after a night in which both genuine defects were found by asking what the code does at
realistic scale rather than fixture scale.

Two cases, both at the cap rather than near it — 60 is the largest import the action accepts,
so this is also `tooManyRows`' upper boundary from the accepting side:

- **60 rows import as 60 leads**, nothing skipped, nothing attached, and every lead carries its
  own evidence. The signal count is asserted as an identity against the database rather than
  against 300, so it survives the day a row yields a different number of claims, and the
  per-lead sum is checked too — otherwise one lead receiving all 300 would pass.
- **Re-importing the whole packet adds no lead and no claim**, with `leadsAttached` asserted at
  60 so it cannot pass by failing to match them. This is the case a reviewer actually performs
  after an addendum, and where 60 duplicate leads and 300 duplicate claims would have shown up.

Both pass. 54 db tests, from 52.

**AND THE THING THIS TEST CANNOT SEE, MEASURED SO IT IS NOT HAND-WAVED.** It establishes
correctness, not production speed, and the gap is wider than "a few queries per row". With
`log_min_duration_statement=0` on and counting what lands between this import's own `BEGIN`
and `COMMIT`:

> **484 operations inside ONE transaction** — 120 SELECT, 120 INSERT and the prepared-statement
> traffic around them, about **8 per row** — totalling 39 ms of statement time over a local
> unix socket.

Production is Neon through a pooler with `connection_limit=5`, where each of those is a network
round trip: ~2.4 s at 5 ms, ~10 s at 20 ms, plus the compute wake CLAUDE.md records for an idle
Neon. So a full-size import is the likeliest thing in this feature to be slow or to hit an
execution limit, and **39 ms on a unix socket is not evidence against that** — it is evidence
from the one machine where the question does not arise.

**Deliberately not optimised here.** Batching the per-row lookups into one query each would
change the ordering the in-pass and cross-import rules depend on — code that has just been
through two adversarial reviews and had two scope errors in two days — and it would be a
performance change verified on the one machine where performance does not matter. The number is
written down so the decision belongs to somebody rather than to nobody.
