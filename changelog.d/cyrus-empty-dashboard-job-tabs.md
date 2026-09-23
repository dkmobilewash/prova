### A new account's dashboard starts with the job, and the job pages use the screen (Cyrus)
`cyrus/empty-dashboard-job-tabs`

**The dashboard.** A company with no jobs opened on about ten empty boxes:
four tiles reading $0.00 / 0 / 0 / $0.00, two "nothing" field cards, two
money cards and "No active jobs". "New job" was on screen two. Now a
company with no jobs sees the jobs empty state first ("Start your first
job", plus a faded EXAMPLE list labelled as one), then the Getting started
card, then the Ask box. Every other section comes back with the first job.
The one exception is a licence or certificate that is running out, because
that can exist before any job, so that card still shows when it has
something in it. The page is now `working` width instead of its own
`max-w-5xl`. A field role's "Needs attention" row is sized to its one tile
instead of one tile in a four-wide row.

Presentation only: no query, figure or calculation changed. The check is a
before/after render of the populated page, main against this branch, for
owner, field and office roles. The markup was identical apart from the
width wrapper, plus the field role's grid class. `new-account.test.ts`
pins both halves, and reverting the gate either way turns it red.

**The job pages.** `jobs/[id]/(tabs)/layout.tsx` put the header, the tab rail
and every tab body in a 768px `mx-auto max-w-3xl`, and no tab could get out
of it. The layout is now a `working` `PageShell`. A tab narrows itself with
the new `PageColumn width="reading"` from `@prova/ui`: Compliance, Retainage
and Field reports do. Overview, Estimate, Crew & time, Billing and Photos
take the full width. `pageWidthCensus` drops from 51 to 49.

**The job header.** It put five tiles in `sm:grid-cols-4`, so "Dates" sat
alone beside three blank cells on every job an owner opened. The column
count now follows the number of tiles this viewer gets
(`components/jobSummaryGrid.ts`). On narrow screens the last tile spans the
rest of its row. `jobSummaryGrid.test.ts` works out the columns at every
breakpoint from the real class strings and requires every row to be full.
Putting the old grid back fails it.

**The Retainage tab with nothing withheld.** Before, it showed three $0.00
tiles and a "Log release" form for money nobody holds. Now it shows one
sentence with a link to the Billing tab. The figures and the form come back
as soon as anything is withheld or released. "Snapshotted" is now plain
English.
