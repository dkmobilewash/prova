### The supplier quote you recorded can now set the price you bid (Diego)
`diego/quote-pricing`

`/vendors/pricing` has been telling estimators, correctly and uselessly, that
"your catalog default is N% under what anyone will actually sell this at" —
and then ending with "nothing has been changed; updating the catalog is a
decision about your own pricing, and it belongs on **the catalog**." That link
went to a page where the other half did not exist. A sub priced board off a
negotiated quote by opening two tabs and retyping a number.

`/catalog` now shows, per entry, the cheapest LIVE quote — vendor, price,
source, date — and an owner can make it that entry's default cost in one press.
The sale price is a separate checkbox that holds the existing margin, because
moving cost and moving price are two decisions and only one of them is a fact
the quotes establish.

**The figure is re-derived on the server and the form carries no numbers.**
That is #105 finding 3, applied to the one control in the app that edits a
price every future bid and every AI draft will read: the only thing the request
decides is the margin checkbox. A test posts `defaultBudgetedUnitCost=0.01`,
`unitPrice=0.01` and `price=0.01` at the action and asserts the write is still
the quote.

**It refuses across units rather than guessing a factor.** A quote per MSF is a
thousand times a quote per SF, and a plausible conversion is how a bid goes out
1000× wrong looking entirely normal. When no live quote matches the entry's own
unit the button is replaced by a sentence naming the units that DO have one.
Every notion of current, expired, cheapest and same-unit is imported from
`components/vendorPricing.ts` — the vendors lane's own derivation, read and
never re-implemented, so the button cannot disagree with the badge above it.
Mutation-tested: drop the unit check and the MSF case goes red.

Only the template is written. No `JobLineItem`, no `EstimateVersion` snapshot,
no invoice already drawn from one — the action test's fake Prisma throws if
anything touches a job row.

**Two things worth flagging, both deliberate.** `estimating.prisma` said a
quote never writes a price back into this template; that comment is amended in
this PR, dated, with the reason. The half that stays permanent is the half that
matters — nothing here is ever summed into a job; job cost has one home,
`CostEntry`. And `priceCatalogEntryFromQuotes` asserts `MANAGE_ESTIMATING`
before its owner check, where its sibling `updateCatalogDefaultsFromActuals`
asserts only the owner. That sibling is recorded in
`action-capability-guards`' `OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE`, which spreads
into `KNOWN_OPEN` — a list that may only ever shrink. A new action does not get to inherit that; the sibling is
left alone rather than quietly "fixed" underneath its own record.

No migration. No new route, no nav entry: both tables already export.
