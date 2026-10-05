### A sub's price can lapse, and waste had four different right answers (Diego)
`diego/quote-expiry-waste`

Two columns off the estimating audit, both additive and nullable.

## `BidQuote.validUntil` — whether the price is still good

Every date on a `BidQuote` was about the CONVERSATION: `requestedOn`, `dueBy`,
`quotedOn`, `declinedAt`, `carriedAt`. None of them says whether the PRICE still
stands. So *"Alpha's number lapsed three weeks ago and it is still inside our
bid"* was not merely unreported — **it was inexpressible.** Expiry existed only
on `VendorPriceQuote`, which is the price-book side, not the quotes a bid is
actually built from.

**The policy is reused, not restated.** `isExpired`, `isStale`, `daysBetween`
and `STALE_AFTER_DAYS` in `components/vendorPricing.ts` already answer "is this
price still good", including the off-by-one that makes a price held *"until the
30th"* good ON the 30th, and the rule that a date the sub gave outranks our
90-day heuristic until it lapses. Both functions were widened to structural
parameter types so a `BidQuote` can ask the same question and get the same
answer; `isStale` additionally takes a nullable `quotedOn`, because a bid quote
has no date until the sub answers and a price nobody gave cannot be old.

The mutation is the proof that reuse is real rather than cosmetic: flipping
`isExpired` to `<=` reds **the existing vendor-pricing test and the new
bid-levelling test together.** One implementation, two consumers, and the end it
would get wrong is the one that tells somebody a live price is dead on the day
they need it.

**Two places it shows, and the second is worth more than the first.** A badge on
the row says `Price lapsed 2026-09-01` or `Priced 156 days ago — worth
re-checking`. Above the packages, `carriedQuoteLapsed` says the thing that is a
fact about the BID rather than about a row: the price you carried is the number
inside what the GC was sent, so a lapsed one gets named with its vendor and date
and a request to confirm it still stands — the posture `underCostWarning` takes
by reading the whole estimate rather than each line. A lapsed quote **nobody
carried** is deliberately silent: warning on it would make the warning routine,
and a routine warning is unread.

**Advisory, never a refusal.** Subs honour old numbers all the time and the
estimator is the one who knows whether this one will. Amber, not rose.

`validUntil` lives on the answer form only, so it takes the `formData.has`
treatment `requestedOn`/`dueBy` already use — otherwise editing the request half
of a row would wipe an expiry the sub had given.

## `CompanyBidDefaults.defaultWastePercent` — one answer instead of four

Waste had four hard-coded answers for one question. `WallTypes.tsx` prefilled
**`"0"`**, `TakeoffForm.tsx` prefilled **`"10"`**, and `takeoff.ts` and
`takeoff-recipes.ts` each fell back to **`?? 10`**. So the same question got two
different answers on the same job depending on which form you reached it
through, and zero is the worse of the two: a component authored without thinking
about waste bought the exact material the geometry needed and no offcuts.

One company figure now answers all four, with `DEFAULT_WASTE_PERCENT` (10 — what
the takeoff form already used) as the floor when nobody has set one. **No
existing estimate moves by a cent.**

**It is NOT a recap rate and the code says so three times.** `ratesFromForm`
walks `RECAP_RATE_KEYS` and this is outside that list, so it is written
explicitly in `saveCompanyBidDefaults`; the settings form takes it as its own
prop rather than inside the rate map, because folding it in would put it one
careless `Object.keys` away from being multiplied into a bid total; and the
export dataset names it separately, with its note reworded, since a customer
reading a CSV headed "Default markup rates" would otherwise read it as one.
Waste buys more material — it does not charge more for it.

Nullable rather than defaulted to 10 in the column: "has not decided" and "chose
10" are different facts, and only one of them should survive us later changing
our mind about the sensible default.

## Verification

Two censuses caught real things rather than being appeased. `exportColumnCensus`
demanded a bucket for both columns. `colorTokenCensus` caught the new date input
copying its neighbour's `bg-surface-input` — an **undefined** token (issue #573,
39 form fields with no ground on a near-black canvas) whose site count the
census pins; it is `bg-canvas` now, which is what `BidDefaultsForm`'s own inputs
use.

`typecheck`, `lint`, 569 files / 8,840 unit tests, and the 63-file/632-test db
suite run locally against the new migration. Announced in `#prova-build` before
the push, per rule 4.
