### "Add 10% for night work" puts one line on the bid, worked out by code (Cyrus)
`feat/ask-adjust-estimate`

Contractors adjust a bid in sentences — "add 10% for night work", "add
$2,500 for mobilization", "take 3% off for the GC" — and Ask had no way to
do it: `addLineItem` was excluded because its unit price was a number the
model would be supplying. The new `adjust_estimate` command takes the
person's figure exactly as typed, their own label, and whether they said
"off", and computes everything else in `lib/estimating/estimate-adjustment.ts`.
A percentage is taken of the bid as it stands — `bidTotalOf` over the live
lines, the same total the job page's "needs you" list uses — in integer
cents, rounded to the nearest cent with half a cent away from zero. The card
reads "Night work — 10% of $78,350.00 = $7,835.00"; the line lands as 1 LS
through the job page's own `addLineItem` action, and its description keeps
the base so the record explains itself after the card is gone.

Refused with a sentence rather than a card: over 100%, 100% off or more, $0,
a dollar discount as big as the bid, a percentage of an estimate with nothing
priced, and a minus sign the person did not back with "off". A `%` sent as a
dollar figure (or the reverse) is a question, not a guess. At the tap the
command re-checks MANAGE_ESTIMATING + VIEW_JOB_COSTS, the ESTIMATE stage,
and re-derives the base: if the bid moved since the card was made it writes
nothing and asks them to ask again. Each guard was mutated out and its test
went red (eight mutants, all killed).
