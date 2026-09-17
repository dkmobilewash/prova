### Overhead and profit, as its own line between the subtotal and the total (Cyrus)
`cyrus/overhead-and-profit`

A construction manager walked through the product on a recorded review with
his own change-order request in hand. On his document, overhead and profit
is an explicit line between the subtotal and the total. On ours there was
one figure and it was the subtotal, presented where the total goes — so a
change order left this app claiming a number the sender did not intend to
ask for.

`Company.overheadAndProfitPercent` is the standing rate, set in
Settings → Company. It is **copied onto** each change order when the draft
is opened — `ChangeOrder.overheadAndProfitPercent`, the same pattern
`Job.retainagePercent` uses against `Contact.defaultRetainagePercent` — and
is editable there while the change order is still a draft. Copied, not
inherited at read time, for two reasons: a document already sent to a GC
must not change its own total because somebody edited a setting afterwards,
and a null that meant "look at the company" could never express "this change
order carries no O&P", which is a real thing to write on a credit.

**ONE combined percentage, not separate overhead and profit rates.** His
document carries a single "Overhead & profit" line, a GC's contract caps it
as one allowable markup, and two numbers would immediately need a stored
rule for whether profit compounds on overhead or sits beside it — derived
state, and a rule nobody would ever see to check.

**The override lives on the change order only.** That is the document he
showed it on, and adding it to estimates as well would have been the "add it
in four places to be safe" the brief warns about — an estimate has no
subtotal/total block rendered to a GC today, so there is nowhere for the
line to print.

**Unset reads as NOT SET, never as $0.00.** A 0% rate and an unconfigured
rate produce the identical total and are different claims, and only one of
them should send a PM to the contract. So an unset rate renders "Not set"
in the amount column, is **excluded** from the total rather than added as
zero, and carries a note saying the total is the subtotal. `amount` is
`null`, not a `Decimal` that happens to equal zero, so no downstream caller
can format it into a dollar figure by accident. Same refusal-to-guess
`estimateBurdenedLaborCost` makes about a fringe schedule.

The money is real, not just printed: approving a change order writes the
markup as an ordinary `JobLineItem` tagged with `originChangeOrderId`.
Contract value, WIP, retainage and every pay application are
`SUM(JobLineItem)`, so applying only the proposals would have moved the
budget by the subtotal while the GC agreed to the total — a silent shortfall
of exactly the markup on every approved change order, invisible until
somebody added the invoices up. Pending-change-order exposure and the Ask
tool now quote the bottom line too.

Checked by 24 unit tests on the arithmetic and the unset/zero distinction,
and 10 action tests that approve a change order and read the rows back —
$10,000 of scope at 15% has to leave the job worth $11,500, an unset rate
has to leave it worth $10,000 with no markup row at all, and a −$4,000
credit has to carry −$600 back with it. Both halves were mutation-tested,
including making unset read as zero: every one went red.

One bug this branch caused and fixed on the way: teaching `fake-prisma`'s
`withIncludes` to resolve an `include: { job }` made it **overwrite** a
relation a row had been seeded with inline, which is the older convention
and what the QuickBooks tests use. Ten tests in a file this change had
nothing to do with started failing on `invoice.job.companyId`. A seeded
relation now always wins over a resolved one.
