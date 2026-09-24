### The bid recap — a line-item total becomes a bid (Diego)
`diego/bid-recap`

A job's line items are the DIRECT cost of the work. Until now that sum was
also, silently, the "contract value" — so the number on the estimate screen
carried no markup on material, no overhead, no profit, no sales tax, no bond
premium and no contingency. Every estimating product in the market has this
layer (OST calls them Section Markups); a grep for `overhead`, `profit`,
`markup`, `escalation`, `bond` or `salesTax` as fields in this repo returned
nothing at all. An estimator was marking the number up in their head.

`lib/bid-recap.ts` is the layer: markup per cost type, then escalation, sales
tax on the material, overhead, profit, bond, contingency, in that order. **The
order is the decision** — profit computes on the total INCLUDING overhead, so
a profit rate earns what it says; tax applies to material at what the material
is sold for, not what it cost. Both are pinned against worked figures in
`bid-recap.test.ts`, and reordering profit and overhead turns two tests red
(mutation-tested).

Markup per cost type needed a cost type, which an estimate line did not have —
`CostCategory` lived only on `CostEntry`, i.e. on money already spent. So
`JobLineItem.costCategory` is new: nullable, no backfill, the `phaseCodeId`
precedent. **An uncategorised line is reported and marked up at nothing**,
never at some default.

**Applying the recap writes the bid into the line prices**, pro-rata, because
`contractValue` in this app is one number doing two jobs — what we bid and what
the contract is worth — read by every invoice, retainage and WIP surface. After
the GC accepts, that number has to BE the bid or everything downstream is short
by the markup.

Two honesty notes, both on screen rather than only here. A stored unit price
holds two decimals, so on a 1,000-unit line the smallest change to that line is
ten dollars: an exact landing is not available, and the panel shows what the
spread actually comes to beside the bid rather than claiming the bid was
written. And applying twice COMPOUNDS — it marks up prices that already carry
the markup — so the screen says when it was last applied and at what, and the
test pins the compounding rather than pretending it cannot happen.

Company-wide defaults live on Settings and pre-fill a new job's recap, the
`Contact.defaultRetainagePercent` pattern: changing them never moves a bid
already built.

Not in this PR: the employer statutory burden (Cyrus's #464 owns it), and the
GC-facing proposal printing the marked-up total — that waits for #460 to merge
and is a small follow-up.
