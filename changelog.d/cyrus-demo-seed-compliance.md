### One button now produces a company you can film the compliance beats on (Cyrus)
`cyrus/demo-seed-compliance`

`seed-demo.mjs` exists because a product whose whole argument is DERIVED
state demos as blank without data to derive from. It had a hole in exactly
the place that argument is strongest: **five union-compliance screens read
rows this script never wrote.** No union local, no craft classification, no
fringe rate schedule, no crew member, no payroll register line. So the
apprentice ratio, the monthly fringe remittance, the certified-payroll
review, the WH-347 itself and the wage-determination standing line all
rendered empty states — on the features that are hardest to argue for in the
abstract and most convincing with real hours behind them. Three independently
written shooting scripts named those beats; two called one of them the single
best moment in the product. Building it by hand before recording was measured
at 20–26 minutes, and again for every reshoot.

It seeds them now, on Riverside Medical Office Building: Carpenters Local
2154, six craft classifications, ten effective-dated rate schedules across two
adjacent windows, six crew members with the WH-347 column 1 identifiers, 49
craft-tagged time entries over two weeks, a payroll register matching the
filing week exactly, and two issued payroll numbers.

**The row that matters most is the one that is deliberately INCOMPLETE.**
`Acoustical Ceiling Installer` has no tier recorded and no rate schedule, and
it carries sixteen real hours. Nothing in the code special-cases it: the
apprentice ratio cannot place those hours on either side of the rule, so the
day reads INCOMPLETE — "no honest verdict exists" — instead of quietly
counting them as journeyman hours and certifying the day compliant. The
remittance refuses to price them for the separate reason that no schedule is
effective, and NAMES the two men behind them rather than valuing the hours at
zero. Those are the two answers this product gives that its competitors do
not, and neither was reachable in a demo before. **Do not "fix" that craft.**

**What the run produced, cross-checked rather than asserted:** the ratio is
9 days judged, 7 within, 1 over by 5.33 hours, 1 that can't be judged;
the remittance totals **$8,240.80** over 380 hours with **16 hours it refused
to price**; the WH-347 prints a full Monday-to-Friday week with rates, gross,
deductions and net on every one of six workers, and blocks only on the three
fields no data can supply (the job has no location or contract number column,
and page 2 is not built). The standing line reads "In force on May 28 2026,
when the job was advertised. Its expiration Aug 26 2026 has passed with a
single asterisk (*), so it holds for the life of the project" — three entered
dates and a published DIR rule, stored nowhere.

**And a contradiction the seed has been shipping on the one document a GC
reads.** `submitPayApplication` sets an invoice's `amount` to
SUM(thisPeriodBilled + materialsStoredValue) and its `retainageWithheld` to
`retainageWithheldFor(amount, retainagePercent)` — one formula, one file. The
two seeded Riverside pay applications satisfied neither: invoice 1 said
**$86,450.00** against line items summing **$94,650.00**, with **$4,550.00**
of retainage against 5% of either figure. The G702 foots to its own
continuation sheet, so it printed "CURRENT PAYMENT DUE $90,100.00" beside a
billing tab saying the invoice was $86,450.00 and PAID IN FULL, with a payment
row for exactly that. Every figure is DERIVED from the breakdown now rather
than typed beside it, so changing a line moves both. Verified against the real
`loadPayApplication`: the certificate's retainage-to-date, the job's own
SUM(retainageWithheld) and the G702's own identities all agree at
**$7,647.50**, and the company figure at **$21,067.50**.

**Dates are anchored to a Sunday, not to "n days ago", and that is the part
worth copying.** Three screens cut this data on a week boundary and they do
not use the same one — certified payroll counts Sunday-to-Saturday, the
overtime review counts Monday-start, the remittance counts a calendar month.
`sundayOf(day(-7))` is a Sunday whose whole week is in the past whatever
weekday the seed is run on, and nothing is logged after that week's Friday, so
the WH-347 opens on a FULL week rather than on whatever fragment of the
current one has elapsed. The determination's issue date is derived from the
job's bid-advertisement date the same way (`dirIssueInForceOn`): hardcode a
DIR issue beside a bid date computed from today and the pairing is correct for
about five months, then silently turns the standing line red about nothing.

**Two guards caught this and neither was a formality.**
`counterCensus.test.ts` went red on the new WH-347 payroll number, exactly as
its own comment promises it will — "if you add a numbered family to the seed,
this fails and the fix is to add the accessor here AND seed its counter, which
is the review, not a chore". `seed-reseed-guard.test.ts` went red because
`undo()` scoped two new families by tag that the re-seed refusal did not count,
which is the #180 half-finished-seed shape. Both lists were updated, and the
count in prose beside one of them is gone rather than refreshed.

**Removability, proved by running it.** `--undo` removes all of it —
`payrollRegisterEntry: 6, workerCraft: 6, crewMember: 6, fringeRateSchedule:
10, apprenticeRatioRule: 1, companyUnionAgreement: 1, craftClassification: 6,
unionLocal: 1` alongside the hours, schedule days and payroll numbers — with
zero failed deletes, and the tables read zero afterwards. The one that would
have blocked is `PayrollRegisterEntry`: it hangs off a crew member with no
`jobId` at all, by design, because a paycheck covers everything the person
worked that period. Deleting the jobs never reaches it and it refuses the
crew-member delete on its own. That is the #227 shape arriving through a
company-scoped table instead of a per-job counter. `HANDLED_MODELS` needs no
change — none of the new models carries a `jobId` — and
`scratch-cleanup-order.test.ts` stays green because none of them is a RESTRICT
child of `Job`.
