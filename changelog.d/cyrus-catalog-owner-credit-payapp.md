### Your paste survives being refused, and a pay application cannot quietly become a credit (Cyrus)
`cyrus/catalog-owner-credit-payapp`

Two defects that destroyed a contractor's work or put a wrong number on a
document a GC reads. Both reproduced by execution first, and every guard
added here was mutation-tested — put the defect back, watch the test go red.

**1. Two `/catalog` buttons threw at the person the page is for.**
`/catalog` demands `MANAGE_ESTIMATING` and ESTIMATOR holds it, by design —
pricing work is what an estimator does. But "Import a price list" and
"Update default from actuals" are owner-only in the actions behind them, and
neither was gated on the page. So an estimator could open the page, paste two
hundred rows out of a supplier's spreadsheet, preview them, click Add, and
hit `assertOwner`, **which throws**. Production redacts a thrown Server
Action message to a digest, so what he got was the error boundary — and the
error boundary unmounts `CatalogImport`, whose pasted text is React state and
lives nowhere else. No reason on screen, and nothing to go back to.

The re-price button threw at the OWNER too, on an ordinary race:
`repriceDecision` re-checks the flag and the sample that made the button
appear, because the page may be minutes old, and its refusals are the useful
ones — add a fringe rate schedule covering the craft and dates those hours
were worked; recategorise the cost entry sitting beside logged hours. Every
one of those sentences was thrown, and so redacted.

Both actions now return `ActionResult` and refuse with `ownerRefusal`, which
is the rule `shared.ts` documents: `ownerRefusal` RETURNS and belongs in
anything declaring `ActionResult`, `assertOwner` THROWS and belongs only in
the older throw-style actions. `ownerRefusalCensus.test.ts` holds it from
here. And the page no longer renders either control to a non-owner — hidden,
not disabled, because a disabled button beside a live textarea invites the
paste and explains afterwards. Both halves are needed: a page guard stops a
page rendering and does nothing about the endpoint behind it.

Both forms post through `<ActionForm>` — #414's component, which landed
while this branch was open and is exactly the right shape for a form whose
action returns a refusal. A bespoke `CatalogRepriceForm` existed here for a
few hours and was deleted on the rebase: two conventions for one thing is how
this repo got sixteen copies of `InputError`. That also paid off
`CatalogImport`'s line in `formActionCensus.test.ts`, whose reason was true
about the reset it was written for and beside the point about this file — the
paste was lost to the error boundary, not to `requestFormReset`.

**2. A pay application could net negative and read "Paid in full" in green.**
`payAppEntryError` guards a negative line and an over-release. Nothing
guarded the DOCUMENT, and every row of a certificate can be defensible while
what they add up to is not. Period 1 stores $5,000; period 2 enters the
−$5,000 release and omits the matching positive — half of the two-part entry
the form's own instruction describes. No row is refusable: the line's stored
balance lands at exactly $0 and nothing exceeds its scheduled value. The
invoice came out at **−$5,000.00**, its retainage snapshot at **−$500.00**,
the G702 printed **Current payment due −$4,500.00**, and both the billing tab
and **the GC portal** rendered it as *Paid in full*, in green, because
`balance <= 0`.

The guard is not a refusal, and that is the judgement in this change. A
net-negative application is a CREDIT, and it is the only in-app way to take
back an over-bill on an invoice a GC already has — there is no void, edit or
delete invoice action anywhere, on purpose, because an invoice is an evidence
record that closes rather than deletes. The mistake and the correction are
**indistinguishable in the data**: both are "completed to date went down". So
what is missing is not a rule but the person's intent. The form now shows the
running total as you type — it was never on screen at all — and when it goes
negative it says in words that this asks the GC for nothing and states money
is owed back, with a box to confirm. `submitPayApplication` refuses a
negative total that arrives without it.

**And an over-billed line can now be corrected downward, which it could not
be at all.** The floor on *This period* plus a blanket negative refusal meant
a line billed $60,000 in March where $50,000 was built had no route back, by
any path, ever — the stored-materials release needs a stored balance to
release. That floor has now been in three places and been wrong in all of
them: `min="0"` in the markup, then `{ min: 0 }` in the action where #414
correctly moved it hours earlier, and in both cases resting on "there is no
negative-billing mechanism" — true of the release, false of a correction, and
nobody had asked about corrections. That is what a G703 column E is for: the negative goes on the line,
total completed to date comes down, and the GC reconciles it where it
happened. Both are gone, replaced by the bound that was actually worth
enforcing — you cannot un-bill more than the line has been billed. Two tests
that asserted the opposite are reversed, with the reasoning, rather than
deleted.

The "Paid in full" ternary now reads a credit off the AMOUNT rather than the
balance and separates an overpayment from a settled invoice — both were
green before. This branch first did that in its own
`lib/billing/invoice-balance.ts`; #431 had meanwhile merged
`lib/invoice-balance-label.ts` for the same line on the same two pages,
netting retainage out of the balance, and each module got the other's case
wrong. They were FOLDED into #431's file rather than one replacing the
other: credit first (by amount), then overpaid (against the gross, so early
retainage is not an overpayment), then #431's settled / retainage-only /
owing split with its caption. The log-a-payment form now shows only on
owing and retainage-only — #431's `tone !== "settled"` would have reopened
it on a credit. Mutation-checked: deleting the credit branch turns three
tests red, the overpaid branch two, restoring #431's gate one.

#414's per-cell parser moved out of `submitPayApplication` into
`lib/pay-application.ts`, unchanged — a figure the app cannot read still names
its field rather than being quietly zeroed — so that the form can show a
running total from the same reading the server decides on.

Not touched, deliberately: `calculatePayAppSummary`, `assemblePayApplication`
and `retainageWithheldFor`. #409 established that the amount a pay
application ASKS FOR was right all along and ships a test pinning it; that
test still passes unchanged.
