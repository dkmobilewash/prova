### Purchase orders — the priced commitment, separate from the delivery (Cyrus)
`cyrus/purchase-orders`

A construction manager specced this whole feature unprompted on a recorded
walkthrough, down to the worked example: "Quiet Rock, 104 sheets at 32 square
foot per sheet". We had `Vendor` and `MaterialOrder` and neither could hold
it. A material order is a LOGISTICS record and carries no price at all by
design — no quantity, no unit, no cost — because it answers "is it here yet,
and if not who is late". A purchase order is the other half: the priced
document that goes to the vendor and that they invoice against months later.
Both exist in his system; they are not the same record and this one was
missing.

`/purchase-orders` (MANAGE_BILLING) raises an order per job against a vendor,
with the vendor's number and address, a ship-to address, payment terms, an
entered award date and an optional expected date. Lines go on one at a time:
cost code, description, quantity, unit, unit cost. Search across the top
matches job name, vendor, title, and — when you type a bare number — the PO
number, since that is the other thing somebody arrives holding.

Two things it deliberately does NOT do. **It does not send email**: there is
no `sentAt` and no status enum, because a column recording that something was
sent, written before anything can send it, is this repo's "written,
documented, and never called" shape. The seam is
`lib/purchasing/purchase-order-document.ts`, which renders the order as text.
**Nothing here is ever summed into job cost.** Committed money is not spent
money; `CostEntry` against a `JobLineItem` remains the only source of actual
cost, and the cost-code link is attribution only, on the same terms
`MaterialOrder.lineItem` already is.

Numbers come from `PurchaseOrderCounter`, bumped inside the same transaction
as the insert. The check that proves it is not "the numbers count up" —
`max(number) + 1` also counts up, and stayed green when we tried it. It is
that deleting PO 3 of 3 leaves the next order at **4**, and that a failed
insert leaves the counter exactly where it was: reverting to `max(n)+1` turns
five assertions red, which is how we know they mean something.

The #227 trap is handled in all three places a per-job counter needs —
the model, `HANDLED_MODELS`, and the `del(...)` order in BOTH cleanup
scripts. Verified by removing the counter from `clean-scratch-data.mjs` and
watching `scratch-cleanup-order.test.ts` name it. Its census now parses 203
foreign keys; a wrap it genuinely cannot read fails with "the migrations
declare 203 and this file parsed 202" rather than quietly shrinking the set.

No phase-code table: `PhaseCode` is on `cyrus/phase-codes` and is not on
`main`, so the line's cost code points at the existing `JobLineItem` the way
material orders and time entries already do. A second coding concept beside
it would have been far worse than reusing the one that is there.
