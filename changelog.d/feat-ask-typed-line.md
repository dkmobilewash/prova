### "Add 40 hours of cleanup at $65" puts one priced line on the bid (Cyrus)
`feat/ask-typed-line`

Ask could add a line from the price book (`add_catalog_line`) and a percent
or flat adder (`adjust_estimate`), but not the commonest thing an estimator
says: a quantity at their own price. `add_estimate_line` takes the
description, quantity, unit, unit price and an optional cost exactly as the
person said them, and `lib/estimating/typed-line.ts` does the rest: each
figure goes through the job page form's own parser (`lib/numeric-input.ts`)
at two places, and the line total is quantity × price in integer cents, half a
cent rounding away from zero. The card reads "Cleanup — 40 HR × $65.00 =
$2,600.00", with the bid so far and the bid with this line (`bidTotalOf` over
the live lines). The write is the job page's own `addLineItem`, on
ESTIMATE-stage jobs only, with capability and stage re-checked at the tap.

A price nobody said is a question, not a card. Zero or negative figures, a
third decimal place and shorthand like "2.5k" are refused with a sentence. A
line already carrying that description is linked, not doubled.

Why the figures are not matched against the question text: `resolve` cannot
see the question (`CommandContext` carries none), and a figure is
legitimately typed in an earlier turn ("what price?" — "65"), so that check
would refuse the follow-ups the ask-for-it path produces. This follows
`log_payment`, `draft_invoice` and `log_time_entry` instead: figure as typed,
strict parser, read back on the card before the tap. The three line commands'
descriptions now name each other so the model routes between them. The Bid
job box offers it (`BID_ASK_COMMANDS`). Ten mutants, one per guard, all
caught.
