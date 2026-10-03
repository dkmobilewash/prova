### Hours going out, so pay can actually be run (Diego)
`diego/payroll-export`

**No migration. No schema change. Web only.** One of the four rows
FEATURE-AUDIT.md had as Missing.

**THE GAP WAS ONE-DIRECTIONAL.** `PayrollRegisterImport` has read a
finished weekly register IN from Gusto, ADP RUN or Sage 100 for a while —
gross, deductions, net, after somebody else ran payroll. Nothing went the
other way. So the hours a payroll clerk needs existed only on the
certified-payroll screen, and getting them into a pay run meant retyping
them off it. `/api/payroll-export` is that file.

**IT IS A FORMATTER, NOT A SECOND SOURCE OF TRUTH**, and that is the
design rather than a convenience. The assembly that turns a week of
`TimeEntry` rows into per-employee, per-classification hours was fifty-odd
lines inside the page; it is lifted to
`lib/certified-payroll-week.summary.ts` and the page and the export now
both call it. A payroll file that disagreed with the screen it was
downloaded from is worse than no export at all — somebody runs pay off one
and reconciles against the other, and the difference is wages.

**TWO THINGS IT REFUSES TO DO, both money bugs, both mutation-checked.**

*It never writes 0 for a wage it does not know.* `buildCertifiedPayrollSummary`
leaves `wageCost` null when an entry has no craft tag or no
`FringeRateSchedule` effective on its date — "never invents a wage" is
that core's own first rule. A blank cell in a spreadsheet reads as
nothing; a `0` reads as free labour and imports into a pay run as such.
The cell stays empty and a **`Rate known`** column says `no` beside it,
which is a fact a clerk can act on rather than a hole they have to notice.

*It never repeats an employee-level total on a per-classification row.*
Per diem and travel pay are totals for the PERSON. Somebody who worked two
crafts in a week has two rows, and printing their per diem on both doubles
it — in a file that goes into a pay run. They appear once, on that
employee's first row, under a column that says `(employee total)`.

| mutation | `payroll-export` |
| --- | --- |
| control | green |
| unpriced wage exported as `0` | **RED** |
| per diem on every classification row | **RED** |
| a pay type loses its column | **RED** |
| the pay-type list drifts from `TimeEntryPayType` | **RED** |

That last row is the scope half rather than the size half: the test parses
the union out of `labor-cost.ts` and requires a column for each member, so
a fifth pay type cannot be added there and have its hours silently dropped
from every payroll file. A dropped column does not look like a failure —
the hours simply would not appear, and nothing would say so.

**Gated at `MANAGE_COMPLIANCE`**, which is what the certified-payroll PAGE
asks for and therefore the only honest gate: this file is that page's
figures, and gating the download harder than the screen showing the same
numbers would be theatre. A Route Handler rather than a Server Action for
the reason `app/api/export/route.ts` already gives — a download needs a
Response carrying its own content type — and a plain-text 403 rather than
a redirect, because a redirect saves the sign-in page as a `.csv`.

The job is scoped in the WHERE rather than checked after the read, and the
requested week is SNAPPED with `certifiedPayrollWeekStart` rather than
trusted: a mid-week date in the query string would otherwise export a
window starting on a Wednesday and disagree with every other
certified-payroll surface while looking perfectly reasonable.

**Not verified on a screen yet.** 547 files / 8587 tests green, typecheck
and lint clean. Nobody has clicked the link.
