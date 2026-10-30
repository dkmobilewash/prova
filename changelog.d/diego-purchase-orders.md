### A job can be bought out: budget beside the quotes, and a draft purchase order from the one you pick (Diego)
`diego/purchase-orders`

Prova knew what a line was budgeted at and what vendors had quoted, on two
different screens, and had no record of what the sub had agreed to pay
anybody. `MaterialOrder` is a delivery tracker with deliberately no quantity
and no price, and it stays one.

`/jobs/[id]/buyout`, linked from the Estimate tab once a job is contracted,
lists every line except labor with its budget, what is drafted and committed,
and the current quotes in the line's own unit, each showing what it comes to
and how far over or under budget. **Add to draft PO** puts the line on that
vendor's draft, opening the next number from `PurchaseOrderCounter` if there
is none. A typed price covers a vendor with no quote, and a lower-tier
subcontract is a PO with a SUBCONTRACTOR line, per Diego.

**The price comes from the quote row, never the form.** A quote in another
unit is shown and not offered, because nothing here converts units. Line
description, unit and price are snapshots.

**A commitment is never added to a cost.** `lib/open-commitments.ts` has
recorded that agreement since August. Committed appears beside Actual on the
Estimate tab and feeds no WIP, job-cost or percent-complete arithmetic; a test
fails if that code reads the model. Only ISSUED and CLOSED count, so committed
stays $0 until the next PR adds issuing. Drafts show as drafted.

Also: `deleteVendor` refuses a vendor on a PO in words, instead of hitting the
new foreign key and throwing. The check: `purchase-orders.dbtest.ts` submits a
form with a false price beside a quote and requires the quote's price, and
mutation runs show drafts cannot pass as committed.
