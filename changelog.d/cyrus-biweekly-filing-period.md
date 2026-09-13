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
