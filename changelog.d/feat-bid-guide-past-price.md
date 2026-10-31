### C Stream Bid can now say "you priced this wall before — use that?" and price it in one click (Cyrus)
`feat/bid-guide-past-price`

The most common blocker in the guided flow is a rated wall with no price in the price book. The
answer a sub actually wants is the one in their own history: "You priced W2 on Civic Center Annex
in September. Use that?" This adds the suggestion and the action behind the button; the guide
engine that shows the card is separate and names the action as `usePastPrice`.

**What "the same wall" means.** `WallType` is a company-library row, and a wall's estimate lines
are one per component (board in SF, studs in LF, ...), each linked by `wallTypeComponentId`. So a
suggestion is the wall type's whole set of unpriced lines, each matched to the SAME component on
a past job. A price-book item that is not part of a wall is matched by `sourceCatalogEntryId`.
Nothing is matched by description. A past job qualifies only if it can price every unpriced line
(half a wall priced and half still blocking is not one click), a unit that differs is skipped and
never converted, soft-deleted and zero lines are ignored, and the latest job wins by the supplying
line's `updatedAt` (the schema records no "priced on" date; it means "last worked on", so the card
says the month, not the day).

**The write.** `usePastPrice(jobId, arg)` takes only `arg`, the suggestion's own `actionArg`:
`wt:<WallType id>:<8 hex>` or `ce:<catalog entry id>:<8 hex>`, where the hex is a fingerprint of
the exact lines and figures shown (the same idea as `price-refresh`'s `updateToken`). No dollar
amount comes from the client: the server re-derives the suggestion inside the transaction and
refuses, in a sentence, if it no longer matches, if a line was priced by hand since, for a
contracted job, for another company's job, or without MANAGE_ESTIMATING. Cost always moves; the
unit price moves only until the bid recap has been applied, then cost only, the same rule as
"Update prices". Nothing stored is recomputed.

Proved against a real Postgres 16 (nine cases, including a stale token and a hand-priced line
rolling back both lines) and by mutation: removing the recap hold, the unit rule and the
contracted-job refusal each turn a named test red.
