### Two screens stop printing numbers that are quietly wrong (Cyrus)
`cyrus/silent-wrong-numbers`

Both defects were silent. Nothing on either screen suggested anything was
wrong, which is the whole reason they are in one PR: they are the same
failure wearing two costumes — an app doing arithmetic in front of people
who do arithmetic for a living, and not showing its working.

**A week with shift-differential hours lost its weekly overtime and was
certified clean.** Monday to Friday at eight hours, then eight
shift-differential hours on Saturday: forty-eight hours worked, a
forty-hour week, and `/prevailing-wage` reported **zero disagreements**
and printed *"Every day matches what the rules imply."* The control —
the identical week with Saturday entered as straight time — correctly
found eight hours of overtime.

The cause is one `?? 0`. A shift-differential day is deliberately not
judged (that premium is for WHEN the shift ran, not how long it was), so
its `expected` split is null — and the weekly pass summed
`day.expected?.STRAIGHT ?? 0`. The Saturday therefore contributed **zero
hours** to the forty-hour threshold, the threshold never tripped, and
Monday to Friday's verdict was wrong as a result. A footnote explained
the Saturday. Nothing anywhere said the other five days had been
affected. That is a DOL back-wage finding on the screen built to prevent
one, on a document union contractors file under penalty of perjury.

The fix separates two things that had been collapsed. A shift-differential
day's hours ARE hours worked and now count toward the forty; what cannot
be said is which pay type they should carry, and that is a statement about
the DAY, not about the week. So the week is counted correctly, the
judgeable days keep their correct verdicts, and the part no rule in this
app can settle is named: *"8 hours past the weekly overtime threshold fall
on 2026-08-22, which carries shift-differential hours… check them by
hand."*

The obvious fix was wrong and there is a test pinning it out. Pushing the
excess back onto the last judgeable day would report **Friday** as
overtime — for hours worked inside the first forty of the week. That is a
different wrong answer, not a fix, and it passes every check the naive
version of this guard would have had.

The green sentence is no longer a `?:` in JSX. It was
`disagreements.length === 0`, which is TRUE of the forty-eight-hour week
above; it is now `reviewIsClean()`, a function a test can execute. Both
halves were mutation-tested — restoring the old sum, and writing the
naive fix, each turn the new tests red.

**The receivables panel's own three numbers did not add up.** Invoiced
$100,000 / Paid $85,000 / Outstanding **$5,000**, with the $5,000 bolded
and nothing on the panel naming the missing $10,000. `outstanding` comes
from `arBalanceFor` and is NET of retainage — correctly, since retainage
is not due until substantial completion — while the other two figures are
gross. `/cash-flow` captions the identical subtraction; the Ask tool names
it separately for exactly this reason; this tile was the one AR surface
that could not, because `OverdueInvoice` did not carry the column. A
bookkeeper tying this out concludes the app is broken, and she is not
wrong to.

It carries it now, read once and passed on rather than read twice — the
figure that was subtracted has to be the figure that is captioned.

**And the same subtraction on two pages, one of them the GC's.** The job
billing tab and `/portal/[token]/jobs/[jobId]` each computed a gross
`Number(invoice.amount) - paid` inline and painted anything positive amber
next to the word "Balance". On an invoice paid to its net-of-retainage
amount that is an amber debt nobody owes — shown to the sub AND to his GC,
with the log-a-payment form open beneath it on the sub's side. Both now
call one `invoiceBalanceLabel`, so the two sides of the table are shown
the same arithmetic, and "Balance" means on those pages what it means on
`/cash-flow` and on the Today tile. The log-a-payment ceiling is
deliberately unchanged and still gross: a GC is entitled to pay retainage
early and the ledger has to accept the cash that arrives.

**One test of ours was vacuous and got caught by its own mutation run.**
It claimed the exact-cents route printed a different figure from the float
route. It does not: `money()` rounds the 1e-13 away and the 0.005
threshold absorbs it, so no input this app can produce distinguishes them,
and the test passed with the mutation in place. It now pins the identity
that a refactor CAN break, and says plainly what importing `arBalanceFor`
does and does not buy. Same shape as the watcher whose needle was already
on the page.

**Reported, not decided — two things found next door that are product
calls, not ours.** Certified payroll runs a **Sunday** week
(`lib/certified-payroll-week.ts`) and the prevailing-wage review runs a
**Monday** one (`components/fieldReportWeeks.ts` — not `lib/`), so the two
screens never describe the same seven days; and the overtime engine has
exactly one production call site, the review page. `buildWh347` never
consults it, so the filed document reports whatever pay type was entered
per entry, with no threshold anywhere in the payroll modules. Neither was
touched. Both have legal consequences and belong to Cyrus and Diego.
