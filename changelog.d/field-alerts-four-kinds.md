### The field produces rows nothing ever chased — now four of them ring the bell (Cyrus)
`cyrus/seed-counters-zzbqtu`

Every alert in this app was about paper or money: a COI expiring, a backcharge
unanswered, retainage sitting, a submittal with the GC. The office side has
been chased since the bell was built. **The field side produced rows nobody
was ever told about**, and all four of these were derivable from data that
already existed:

- **a delivery that never came** — `MaterialOrder.promisedFor` against today
- **a punch item nobody came back for** — `PunchListItem.dueOn`, OPEN only
- **equipment still out** on a job, sometimes a job that has finished
- **a delay the GC was never told about** — `gcNotifiedAt` null

The last one is the most valuable and the most galling. What makes a delay
claim collectible is that the GC was told AT THE TIME, so a delay sitting here
with no notice recorded is evidence the sub has already paid for and cannot
use. The Ask read tool `daily_field_reports` has counted
`delaysTheGcWasNotTold` all along — **the derivation existed and nothing
surfaced it.**

**None of this is AI, and that is the finding.** The instinct was to reach for
a model to "notice" these. Every one is a date compared against today, which
is the same `severityForDate` call the eleven older kinds make. A model here
would have cost money to be worse.

**What they refuse to say is the design.** Where a date exists the alert is
DATED and says how late. Where no date exists it is STANDING and says what it
does not know, because "overdue" against a date nobody recorded is a claim
about a contract this app has never read. `operations.prisma` puts it best and
the delivery alert obeys it literally: *"a guessed date is worse than no date,
because 'late' would then be measured against a guess"* — so an order with no
promised date is never called late, only silent for however long it has been.
The delay alert never goes OVERDUE at all, however old, for the same reason
`createLienDeadline` is excluded from the Ask commands: the notice period is
legal advice and the app refuses to generate it.

All four take `MANAGE_FIELD`, matching what `ROUTE_CAPABILITY` already gives
the pages they point at. An alert is a summary of the thing it points at, so
somebody who cannot open `/punch-lists` is not told what is on it.

**Three existing guards caught three real mistakes on the way in, and they are
the reason this entry can be trusted.**

`alertLabels.ts`'s total `Record<AlertKind, string>` failed the typecheck the
moment the union grew — so a kind cannot ship without words a person would
read.

The horizon floor test caught a **3-day** warning window on late deliveries.
The argument for 3 was about the bell and it ignored the digest: `week` fires
at days<=7 and `approaching` fires off severity, so a horizon under the rung
makes `week` cross FIRST and **the approaching mail silently never sends.** A
notification no code path can reach — this repo's "written, documented, and
never called" shape wearing a number. Now 7, with the reason written beside it.

`hoursRenderCensus.test.ts` caught the delay alert interpolating
`hoursLost` raw. That column is `Decimal(7,2)` and `parseDelay` COMPUTES it
from workers × minutes ÷ 60, so it is exactly the floating-point sum
`render-hours.ts` exists for — four men over 200 minutes is
`13.333333333333334` without it. Routed through `formatHours` like every
other hours figure in the app.

**And the builders are CALLED**, which is the check that matters rather than
the one that looks complete: four `export function`s in `alerts.ts`, four
`...call(` sites in `loadAlerts`, verified by grep rather than by the diff
looking finished.

`alerts.field.test.ts` is 18 tests over the seam all four share — a record
that carries a date and a record that does not. The assertions that matter are
the second kind: STANDING after a named chase window, silent before it, never
OVERDUE, and a DIFFERENT `alertKey` once a date is finally recorded so that
dismissing the vague version cannot silence the specific one.

**Deliberately not built: the missing daily field report.** It is the fifth of
the five and the only one needing a cross-model derivation — days that have
`TimeEntry` rows and no `DailyFieldReport` — which is a real query cost rather
than a single-table date comparison. It belongs with the report-drafting work,
not here.
