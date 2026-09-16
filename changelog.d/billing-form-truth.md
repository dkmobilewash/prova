### Two billing forms recorded the wrong date and dropped a fee (Cyrus)
`cyrus/billing-form-truth`

**A payment said it arrived the day somebody got round to typing it.**
`Payment.receivedAt` was `@default(now())` and no form sent anything else, so
the stored date was the timestamp of the click — and
`lib/quickbooks-payment-sync.ts` sends that same column as QuickBooks
`TxnDate`. Prova and QuickBooks therefore disagreed by however long the cheque
sat in the mail, and the reconciliation report flagged a discrepancy that was
never real. The log-payment form now has a **Received** date, entered rather
than stamped, defaulted to the reader's own calendar day.

**A platform fee had nowhere to go, and the columns for it were dead.**
`Payment.feeAmount`/`.feeSource` have existed since #189 with a schema comment
explaining Textura's 0.22%, and `lib/gc-reliability.ts` already reads them —
but **no form wrote either**, so every fee in the product was zero. A sub paid
through Textura or GC Pay had two wrong options and took one of them. The form
now has a small **Platform fee** box, with the box naming who took it
appearing only once there is a fee to attribute.

**And nothing derived the number the columns were added for.** The schema said
cash received is `amount - feeAmount`, derived and never stored. Nothing
derived it. `lib/billing/payment-entry.ts` does now, in cents, and the payment
row on the job page shows `$220.00 fee (Textura) · $99,780.00 banked` beside
what was applied.

**WHICH NUMBER GOES IN "AMOUNT", because the repo said two different things
and it decides what a person types.** `Payment.amount`'s own schema comment
settles it: it lists both options — "record the cheque that arrived and the
invoice sits short forever, or record the full amount and the fee vanishes" —
and the fee column is what removes the choice. `amount` is the GROSS applied
to the invoice, which is what the balance subtracts and what QuickBooks gets
as `TotalAmt`; put the net cheque there and a settled $100,000 invoice shows
$220 owing here and $220 open in QuickBooks, permanently. The form's label now
says "Amount applied" and the help text says "before any platform fee".

`lib/gc-reliability.ts` reads as though it expected the other convention — its
`paidTotal` comment says "what the sub actually banked" while its input is the
sum of `Payment.amount`, and its test fixture is `paidAmount: 99_780,
feesDeducted: 220`. **That file is deliberately not touched here.** Two
consequences are recorded rather than quietly absorbed, both as tests in
`lib/billing/payment-entry.test.ts`:

  - the reliability timing figures do NOT move when a fee is present on a
    fully-applied payment, because the invoice already settles without the fee
    term. What the fee changes is that the money exists in the system at all;
  - `isSettled` is `paidAmount + feesDeducted >= amount`, which is tolerant of
    both conventions — so with gross amounts the fee term is slack, and a
    genuine shortfall SMALLER than the recorded fee now reads as settled. That
    was unreachable while nothing wrote a fee. It is narrow (a shortfall under
    ~0.22% of contract value) and it is somebody's decision to make, not a
    thing to fix sideways from a form branch.

**What is NOT fixed, and why: the pay application still has no PERIOD TO
date.** A G702 states the period the application covers and it is the field a
GC's accounting department keys on. `Invoice` has `number`, `description`,
`amount`, `issuedAt`, `dueAt`, `status`, `retainageWithheld` and nothing that
means a period — checked field by field, and `submitPayApplication`'s own
comment already says so ("There is no period field on Invoice to use as a
natural key"). `issuedAt` cannot stand in: it is the submission timestamp, the
10-second duplicate-submission guard reads it as one, and `findFirst` orders
by it. **Storing a period needs a column, so this branch does not add one.**

What it does instead is stop the printed document from being misread. The date
in the header was unlabelled, under a G702-style heading, which is exactly how
it gets taken for the period — it now says **"Application date"**, which is
what it is. An on-screen note (not printed) tells whoever is about to send it
that no period is recorded and to write one on the cover sheet.

**Checks.** `readPaymentEntry` and `cashReceived` are pure and tested
directly; `logPayment`'s write is tested with Prisma mocked, because the
dbtest that would cover it needs a database CI does not have and "written,
documented, and never called" is this repo's recurring shape. Sixteen
mutations, each watched red and restored — including two that SURVIVED and
changed the code: the cent-drift test used an example that is exact in floats
(now `100000.04 - 220.22`, which is not), and a `/^\d{4}-\d{2}-\d{2}$/` guard
nothing could kill, because the round-trip check after it already requires
that shape. The redundant guard is gone rather than kept as decoration.
