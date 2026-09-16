### Retainage stopped ageing as overdue, and stopped being counted twice (Cyrus)
`cyrus/retainage-in-ar`

Issue #288. `Invoice.amount` is gross and `Invoice.retainageWithheld` is the
slice of it the GC is entitled to hold back until substantial completion.
The AR balance was `amount - paidAmount` with no retainage term anywhere in
`lib/cash-flow.ts`, so a $100,000 invoice with $10,000 retained, paid to the
penny of what an AIA G702 certifies as due, left a $10,000 balance that aged
1-30, 31-60, 61-90 and 90+ as though the GC were late. They were not late.
That money is not due yet.

The same $10,000 was also in the retainage receivable section of
`/cash-flow`, so the forecast's "AR expected + retainage expected" total
counted it twice. Both halves are one defect: the AR balance had no business
containing retainage, and once it does not, the row total is simply correct —
**the page's `arExpected + retainageExpected` was never the bug and is
unchanged.** `handlers.cashFlowForecast.test.ts` had the doubled figures
pinned as correct: `arOutstanding: 14_000` beside `retainageOutstanding:
3_500`, a forecast of $17,500 against $14,000 of actually-outstanding money.
The new AR figure, 10,500, plus the unchanged 3,500, is exactly the 14,000
the old AR column was claiming on its own.

Third consequence, and the one that looked like an unbuilt feature rather
than a wrong number: `isSettled` in `lib/gc-reliability.ts` compared cash
against gross, so no retainage-bearing invoice could ever settle. The timing
figures were computed over an empty set, `onTimeRate` and `averageDaysToPay`
rendered "—" for every GC who holds retainage — which is all of them — and
those GCs were additionally reported as having SHORT-PAID every invoice they
had ever settled.

**What was established before anything was changed, because the fix depends
on it.** Payments are typed in by a person; nothing derives one from the
invoice, so neither gross nor net is imposed. What is imposed is that
retainage cash has nowhere else to go: `RetainageRelease` is a per-job row
and no flow turns one into a `Payment`. So under a gross reading the same
dollars would be banked as a payment AND still held as retainage — the two
ledgers only reconcile if a payment is net. The `logPayment` ceiling stays
gross deliberately (a GC may pay retainage early, and an invoice ledger has
to accept the cash that arrives): "how much can still be logged" and "how
much is this GC late on" are different questions and now have different
functions. `packages/db/scripts/seed-demo.mjs` contradicts this — it logs
payments at the full gross amount while leaving the retainage unreleased,
which double-counts $13,420 on Cedar Park and $4,550 on Riverside — and is
deliberately left alone here; it is a fixture, not a flow, and changing it
is a separate call.

One rule, one function. `arBalanceFor` is exported from `lib/cash-flow.ts`
and imported by `/cash-flow`, the Today receivables tile and the Ask
`receivables` tool, because this repo has twice shipped two surfaces that
mirrored an invoice rule by hand and disagreed about which invoices were
overdue. The subtraction is done in whole cents: `1000.35 - 100.04 - 900.31`
is `1.1e-13` in floats, positive, so a settled invoice would have aged for
ever at a balance rendering as $0.00.

Both surfaces now say what they left out — `/cash-flow` prints the retainage
netted out of the aged balances and where it went, the contact page prints
what its timing figures were not asked about — because a table 10% lighter
than the invoices behind it with nothing on screen to explain why is the
kind of number this product refuses to show.

**What this weakens, said plainly rather than left in the diff.**
`retainage-single-source.test.ts` asserted that `lib/today-dashboard.ts` must
not name the retainage column at all. It has to now — the receivables tile
nets it out and the reliability column needs it for `isSettled` — so that
half of the #97 guard is gone for that file and nothing static replaces it.
What replaces it is behavioural: `today-dashboard.test.ts` is new, and it
makes the fake `loadRetainageHeld` return a number no sum of the page's own
invoice rows can produce, so summing the column into the company total fails
there instead. `company-financials-query.ts` keeps the strict form.

Four files that touch this money had no test at all before: `lib/cash-flow.ts`,
`lib/today-dashboard.ts`, the Ask `receivables` tool and `/cash-flow` with
money on it (only its empty state was rendered, which is the wrong half for a
money defect). Fourteen mutations were run; all fourteen went red, and one of
them caught a vacuous test of mine before it shipped — a float-dust case whose
numbers did not actually produce float dust.

**Known limit, not fixed here.** An invoice paid MORE than its net but less
than its gross — a GC who paid part of the retainage early — now has a
negative net balance and drops out of AR entirely rather than showing the
remainder. It is still counted in the GC's gross `outstandingTotal`, and in
retainage receivable until released, so no dollar vanishes from the product;
it is only absent from the aging table. Fixing it properly means recording
retainage cash as a release rather than a payment, which is a data-entry
question rather than an arithmetic one.
