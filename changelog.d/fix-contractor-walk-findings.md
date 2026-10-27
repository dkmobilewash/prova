### Four things the contractor walk found in C Stream Bid, three fixed and one explained (Cyrus)
`fix/contractor-walk-findings`

The CI "contractor walk" (`e2e/specs/bid-contractor-walk.spec.ts`) bid one TI
job end to end and printed what every screen said. Four of those sentences
were wrong.

**Plain measurements now count as measured.** "Add as plain measurements —
priced by hand" put 237 LF on the takeoff with no wall type, so no `WallRun`,
and the guide read only wall runs: it kept asking "1 sheet is in, and no walls
are measured yet", and once typed lines were priced the rail said "✓ Walls
measured — Done · 1 sheet, none measured yet". The guide's facts now carry
`handMeasurements` (every `TakeoffMeasurement` not in a wall run, LINEAR ones
read to feet by `measurementPrimitive`). With an empty estimate the ask is
"237 LF is measured by hand but not on the estimate yet" and points at the
takeoff's measurement list; the rail reads "237 LF measured by hand · 1
sheet". Once the estimate has lines it does not nag about unposted
measurements — the sub has priced the job another way.

**The apply-recap ask states what Apply really does.** It said "Applying it
adds $7,385.00 to the bid" — the markup over DIRECT COST — on a job whose
typed prices ($34,915.00) were above the recap, where Apply LOWERED the bid to
$31,990.50. It now reads "Applying it lowers the bid by $2,924.50, from
$34,915.00 to $31,990.50" (or "raises … by", or "leaves the bid at"), and the
figure comes from `applyOutcome` in `lib/bid-recap.ts` — the one function the
recap panel's "Apply to line prices to make it $X", `applyBidRecap`'s
`appliedTotal` and the guide now all read. No pricing arithmetic changed.

**The $73.50 between the recap's $31,917.00 and Apply's $31,990.50 is
explained, not changed.** `JobLineItem.unitPrice` is `Decimal(12, 2)`; on
9,600 SF a cent of unit price is $96 of line total, so the cost-proportional
shares (8.847, 0.80664, 1.36609 per unit) round to 8.85 / 0.81 / 1.37 and
drift +$3.70, +$32.24 and +$37.56. `bid-recap.walk.test.ts` proves no
combination of cent unit prices near the shares reaches $31,917.00 (the
nearest are $31,894.50 and $31,978.00). Landing exactly needs a schema change,
a rounding line, or moving ~$930 between lines away from their cost shares —
each a decision for Diego, so none is made here. The panel already shows both
figures whenever they differ.

**The invite reader says up front when there is no assistant.** In CI, with no
model key, "Fill the form from it" claimed an allowance question, called the
model, failed, and said the invitation "couldn't be read" and was recorded as
a failed question. `readBidInvitationText` now checks `anthropicIsConfigured()`
before anything else and returns "Reading invites needs the assistant, which
isn't set up on this server yet. Type the invitation in below instead." —
claiming, marking and sending nothing — and the Log-a-bid form draws that
sentence in place of the paste box (`inviteReaderAccess.ts`), the way the job
screen's ask box already did.

Checks: each fix has a unit test that was red first and a mutation that turns
it red again; `facts.dbtest.ts` runs the new facts against a real Postgres.
