### An apprentice's untagged hours stopped counting toward their indenture (Cyrus)
`cyrus/ojt-untagged-hours`

A regression from #244, on the record that gates work on public jobs.

#104 finding 9 scoped the OJT sum to the enrollment's craft, so a second
indenture in a different craft could not pull in hours belonging to the
first. Right for TAGGED hours. But `TimeEntry.craftClassificationId` is
NULLABLE and `LogTimeEntryForm`'s craft select defaults to "No craft tag" —
untagged is the ordinary state of a timesheet, not an edge case — and a
Prisma scalar equality compiles to SQL `=`, which **never matches NULL**. So
from #244 onward, a craft-scoped apprentice's untagged hours were silently
dropped from `ojtHoursThisPeriod` and the panel reported them behind their
programme by however many hours nobody had tagged. Before #244 those hours
were over-counted across crafts; after it they were gone. Under-reporting is
the worse of the two: it reads as an apprentice who has not done the work.

The condition is now "the entry's craft matches this enrollment's, OR the
entry has no craft at all". Tagged hours stay attributed to exactly one
enrollment, which is what finding 9 was actually about; untagged hours count
again. A craft-less ENROLLMENT still counts everything, unchanged.

**The residual, documented in the code rather than left to be
rediscovered:** two enrollments open at once for the same apprentice in
different crafts both count the same untagged hours. That is a knowing
over-count of the untagged portion and the better of the two available
wrongs — the alternative drops those hours for every ordinary
single-indenture apprentice too, not just this rare shape — and inventing an
attribution rule (earliest enrolled, say) would record a guess about which
craft somebody worked as a fact on a compliance record. The honest end state
is to report untagged hours as unattributable the way `loadRatioReviews`
already does, where a day with unclassified hours is INCOMPLETE and never
WITHIN; that is a UI change as well as a query one and wants its own issue.
A unit test pins the residual so changing the trade-off has to be
deliberate.

**The apprentice RATIO does not consume this figure and no ratio moves.**
`loadRatioReviews` runs its own `timeEntry.findMany` with no craft equality
at all and folds untagged entries into every local's review as
`unclassifiedHours` (status INCOMPLETE). `ojtHoursThisPeriod` has exactly one
reader, `ApprenticeshipPanel`.

**The check.** `lib/apprenticeship-query.test.ts` is new and pure — no
database. It mocks `@prova/db` with a fake that INTERPRETS the loader's
where-clause under the two rules the defect turns on (a scalar equality
matches by `===`, so NULL fails it; an `undefined` filter is dropped) and
THROWS on any filter key it does not implement, so a future condition cannot
be silently ignored by the sum. Two tests hold the fake to those rules,
because an interpreter nobody checks is a more elaborate way to assert
`true`. Mutation-tested both ways: restoring the equality fails with
`expected 8 to be 14`, and removing the craft filter entirely — #104 finding
9 coming back — fails with `expected 19 not to be 19`.

`apprenticeship-query.dbtest.ts` gains the same case against real SQL,
written as a delta (add one untagged row, the total must move by its hours;
under a craft equality the delta is 0), and two of its existing totals are
updated because the outer fixture's three shifts carry no craft tag and now
count. **Those dbtest changes are UNRUN — this branch has no database and
must not touch one** — so the arithmetic there was derived by hand from the
fixture and is stated in the file as `tagged + untagged-in-window`.
