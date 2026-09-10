### Five alert-engine defects: a leaked figure in the key, and dismissals that outlive their facts (Diego)
`diego/alert-engine-defects-109`

Closes #109. Five findings against `lib/alerts.ts`, the shared alert
engine — all in the money-kind logic and the shared key-generation /
capability-filter machinery, none touching Cyrus's non-money kinds.

**The leak.** `visibleToPrincipal` nulls `alert.amount` for a viewer
without a money capability, but never touched the KEY, and the whole
`Alert` — key included — is a prop on the client component `AlertRow`.
`WIP_VARIANCE`'s key was `WIP_VARIANCE:<jobId>:47231.88`: the exact
overrun, human-readable, in the RSC flight payload, for exactly the
viewer the `amount` field was nulled for.

**The granularity bugs, entangled with the leak on purpose.** Retainage,
closeout and backcharge alerts keyed on their date alone, so a dismissal
recorded at $500 stayed dismissed at $42,000. `WIP_VARIANCE` was the
opposite failure — a cent-exact float in the key — so a $12.40 delivery
ticket minted a new key and the alert could never stay dismissed on a
job with daily cost entries.

One fix closes all three: `moneyFact(fact, amount)` rounds the amount to
the nearest **$1,000** and hashes it together with the kind's other fact
(a date, or a stable marker) through the file's existing `factDigest`.
The bucket absorbs routine small changes; the hash means the figure is
never readable in the key, for any viewer, not just the ones the
capability filter targets. Applied to all four money-bearing kinds —
`WIP_VARIANCE`, `RETAINAGE_RELEASE`, `CLOSEOUT_WITH_GC`,
`CLOSEOUT_REJECTED` — the same way, so none of them keeps its own scheme.
**$1,000 is a judgment call, not a derived fact** — flagged as such in
the PR, since nothing here confirms it against how this business actually
draws the line between "routine" and "worth re-raising".

**The threshold that was never read.** Retainage was flagged OVERDUE the
instant a closeout package was accepted, ignoring
`ALERT_HORIZON_DAYS.RETAINAGE_RELEASE` (14), which nothing in the file
read. It now reads it — DUE_SOON until the horizon has actually elapsed
since acceptance, OVERDUE only after — so a same-day acceptance no
longer outranks a genuinely blown deadline on the strength of its own
day-count.

**The missing alert.** A job holding retainage with no closeout
submission of any kind and no `substantialCompletionDate` raised
nothing — the dead branch neither existing case in `retainageAlerts`
ever reaches, on what can be the largest sum this app tracks. Added as a
third, additive case (existing jobs with either fact behave exactly as
before) with its own key — a stable marker, not amount-bucketed, since
the fact is structural rather than a dollar figure. Needs
`alerts-query.ts` to pass a new `hasCloseoutSubmission` boolean it
already has the data for; no schema change.

**Verification.** Each of the five was mutated back to its old behavior
by hand and confirmed to reproduce the issue's exact symptom before
restoring — including one mutation caught end-to-end by
`lib/alerts-query.dbtest.ts` against a real Postgres, not just the pure
`lib/alerts.test.ts` suite. New tests: bucket-vs-hash behavior for all
four money kinds (a $12.40 change does not re-raise; a $500→$42,000
change does), the horizon boundary for retainage (0 days is DUE_SOON,
just past the horizon is OVERDUE), the new "no path to closeout" alert
and its additive guard, and a leak check that serializes the alert (the
flight-payload boundary a unit test can reach) and asserts the raw
figure is absent once `amount` is stripped.
