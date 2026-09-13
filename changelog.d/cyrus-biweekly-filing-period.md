### What actually changed, in plain English (Diego)
`cyrus/biweekly-filing-period`

A subcontractor whose jurisdiction files certified payroll EVERY TWO WEEKS
was being given a due date one day late, on every fortnight, since #244.

The weeks this alert reasons about run Sunday-to-Saturday — #104 finding 7
moved `alerts-query.ts` onto `certifiedPayrollWeekStart` so the alert and the
certified-payroll sheet finally described the same seven days. The BIWEEKLY
filing period did not come along: it anchored its fortnights on a Monday
epoch (2020-01-06), so the period ran Monday-to-Sunday while every week
inside it ran Sunday-to-Saturday.

Two things followed, both visible. A period's stated end was ALSO the first
day of the next period's first week — Sunday 2026-08-23 was the end of one
fortnight and the start of the next one's first week, so one calendar day
belonged to two filings. And half of all weeks had a `weekStart` that fell
one day BEFORE the period they were filed under, which is the invariant a
filing period exists to satisfy. On screen it read as "period ending
2026-08-23, due 2026-08-30" where the fortnight actually closed 2026-08-22
and the filing was due 2026-08-29.

The fix is one day: the epoch moves to the Sunday before it (2020-01-05).
That was chosen over re-anchoring because it shifts the epoch and every
Sunday week-start by the same day, so `weekIndex` — and therefore the
`BW<n>` alert key — is unchanged, verified over 400 consecutive Sundays.
That is load-bearing rather than tidy: the key is what an
`AlertAcknowledgement` row is recorded against and what
`notification-dispatch` dedupes on, so renumbering the fortnights would have
silently un-dismissed every biweekly alert anyone had already acted on and
re-sent its notifications.

BIWEEKLY had no tests at all — `grep BIWEEKLY alerts.test.ts` returned
nothing — so the check is the point of this PR rather than the one-character
diff. The invariant `periodStart <= weekStart <= periodEnd` is now asserted
as a PROPERTY over sixty consecutive Sundays and all four frequencies,
because the failure was every OTHER fortnight and any single well-chosen
example passes. Thirty of those 240 combinations were misplaced before the
fix. The property counts the checks it actually ran against a number that
cannot drift with the loop, and asserts its sixty generated dates really are
Sundays — a generator returning an empty list would otherwise report green,
since nothing is ever misplaced in an empty list.

Mutation-checked by putting the Monday epoch back with the tests kept: five
assertions go red, including the public one through `certifiedPayrollAlerts`
(`expected 'Certified payroll for Mercy Tower, pe…' to contain 'period
ending 2026-08-22'`).

WEEKLY, SEMI_MONTHLY and MONTHLY were checked for the same class of
misalignment and do not have it — their periods contain their weeks' start
days by construction — and are now covered rather than merely believed,
including the `Date.UTC(y, m, 0)` last-day trick against a leap February.

One limitation is documented and deliberately NOT fixed, with a
characterization test so nobody changes it by accident: a week is bucketed by
the period its FIRST DAY falls in, so a MONTHLY filer's week running
2026-08-30 to 2026-09-05 is filed wholly under August with its period
declared closed on 2026-08-31 — six days of which had not happened yet.
SEMI_MONTHLY does the same across the 15th. Splitting it needs per-day hours
and `CertifiedPayrollAlertSource` carries none, so fixing it here would mean
inventing a distribution. It needs an issue in the estimating/labour lane,
not a guess in this function.

Also corrected: `CertifiedPayrollAlertSource.weekStart` was documented as
"The Monday of a finished week" and `weekEnd` as "The Sunday". #104 finding 7
had already made both false. That stale comment is exactly what a reader
would have checked the BIWEEKLY branch against.

### Corrections from an adversarial review of this branch, 2026-09-13

Three agents built these three fixes and three more were told to refute
them. Two of the refutations landed, and both are fixed here rather than
noted.

**The two property tests could not fail, and they are the load-bearing
ones.** Both asserted `expect(checked).toBe(FREQUENCIES.length *
SUNDAYS.length)` — a count derived from the very arrays the loop walks, so
it is satisfied at `0 === 0`. Proved vacuous rather than argued: changing
the generator to `sundaysFrom("2025-12-28", 0)` left BOTH property tests
GREEN. The counts are now written out (`240`, `60`, `30`), and the same
mutation now turns four tests RED. This is the guard-that-parsed-nothing
scar in CLAUDE.md arriving as a property test, which is why it is worth the
paragraph: a check that derives its input must assert the SIZE of that
input against a number that cannot drift with it.

**The invariant this fix exists to satisfy was still not total, and the doc
block claimed it was.** `Math.round` rounds a Thursday, Friday or Saturday
UP to the next fortnight, so BIWEEKLY returned a period STARTING AFTER the
date it was asked about — `filingPeriod("2024-01-11", "BIWEEKLY")` gave
`BW105 [2024-01-14..2024-01-27]`. Measured across 2024-2031: **546 such
days** before, spread over exactly Thursday/Friday/Saturday. Sunday was
clean, which is why every test passed while the stated property was false.

Not a live bug — the one production caller passes a Sunday — but the
sentence a maintainer would trust was wrong, and `weekEnd` is a Saturday
and the obvious next argument. So the property is made TRUE rather than the
sentence softened: the date is floored onto the Sunday that starts its week
before indexing. Now **zero violations on any weekday**, and the `BW<n>`
key is unchanged for every Sunday — verified day by day across 2,557 days,
because that key is what an `AlertAcknowledgement` is recorded against and
renumbering would silently un-dismiss live alerts. A new test asserts the
invariant over 730 CONSECUTIVE days (every weekday ~104 times) rather than
60 Sundays; reverting the normalisation turns it red with 156 entries.

Two claims in the other two fixes were also corrected in place: a comment
in `apprenticeship-query.ts` still explained the OLD mechanism (Prisma
dropping an `undefined` filter) when the new code omits the key entirely,
and `prevailing-wage-query.ts` claimed its `orderBy` mirrors
`findEffectiveRuleSet`'s comparator — it does not provably, since SQL
orders a raw timestamp and a text collation while the function ties on the
UTC calendar date and JS `>`. Determinism never depended on it; the comment
now says so. `craftScope` is also spread FIRST in its where-clause, so a
top-level `OR` added later cannot silently clobber it.

**Also corrected, three files away and known-false on `main` for four
days:** `certified-payroll-week.ts` stated that the certified-payroll alert
and the prevailing-wage week review "both group by MONDAY". #244 moved the
alert onto this module's Sunday week, so that half became false in the file
whose entire purpose is warning about week-alignment. The offset did not go
away, it MOVED — alert and sheet agree now; alert and the prevailing-wage
overtime review no longer do. Written out as the three workweeks that
actually exist, because the next person will check this file first.
