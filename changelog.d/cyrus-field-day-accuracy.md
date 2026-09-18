### The foreman was filing against the wrong job, and the form was doing it for him (Cyrus)
`cyrus/field-day-accuracy`

Three things a field superintendent hit in one week, all on the same two
screens, all small, and the first one files paperwork against the wrong GC.

**The daily field report defaulted to the alphabetically first job of any
status.** `/field-reports` hands the composer every job the company has ever
had, `orderBy: { name: "asc" }`, and the composer took `jobs[0]`. So the
preselected job was whatever sorts first — an estimate nobody has won, a job
closed out last spring. Work performed is the ONLY field a foreman actually
types; the job and the date arrive filled in. So on every day the alphabet
disagreed with the schedule, the one thing he wrote was filed against the
wrong job, and nothing on screen said so. A daily report is the document a
schedule dispute gets argued from months later.

Why nothing caught it: there was nothing to catch it WITH. `jobs[0]?.id` was
an expression inside a component, not a function, so the only way to assert
anything about it was to render the component — which this suite can do
(`timeEntryRow.test.ts` has been doing it since #63) and nobody had for this
one.

The rule now lives in `lib/field-report-jobs.ts` and it guesses only when
there is nothing to guess between. An explicitly chosen job wins — the page's
own `?job=` filter, whatever its status, because a late report against a
just-closed job is a real errand and the person said which job by filtering
to it. Otherwise, if EXACTLY ONE job is CONTRACTED or IN_PROGRESS, that is the
answer. Otherwise the select stays on "Choose a job…", says why, and the
submit refuses. An unchosen default that is silently wrong is worse than no
default: a blank select costs a tap, a wrong one costs a day's record on
somebody else's job.

Two deliberate calls inside that. CONTRACTED counts as active alongside
IN_PROGRESS — the status column is hand-set, so it lags reality by however
long it takes someone in the office to press a button, and counting it makes
the "exactly one" test HARDER to satisfy, which is the direction to err in.
And it does not pick the single IN_PROGRESS job out of four CONTRACTED ones;
that is the same guess in a better disguise. Every job is still listed, so a
late report against a closed job can still be filed — it just cannot be
chosen for you.

**`/field-reports` had no job filter, while `/punch-lists` and `/photos`
both do.** This is the log a GC asks for by job, and reading it meant
scrolling a company-wide week and picking the right rows out by eye. It now
takes `?job=`, the same `searchParams` shape as `/punch-lists` — an id this
company does not have is treated as no filter at all, so a stale link shows
the whole log rather than an empty page that reads as a company that has never
filed anything. The filtered job is also what the composer starts on, the same
handover `/punch-lists` makes. One line of prose changed with it: a week's
"Nothing filed on any job for Tue · Wed" becomes "on this job" when a filter
is on, because that is a different and much stronger claim.

**The time-entry form reset every field on success.** Hours are entered one
person at a time off one crew sheet, and `form.reset()` put the employee
select back to whoever is first in the company and blanked the date. Eight
carpenters on a Tuesday meant being asked what day it was eight times. It now
keeps exactly the employee and the date and clears everything else — an unseen
8 or a stale per diem carried into the next person's entry is the error that
must not happen quietly. The employee is kept not because the next entry is
the same person but because the alternative was a confident wrong answer;
`logTimeEntry`'s repeat guard is still the thing standing between a foreman
and a double entry, and it always was.

**The evidence.** Ten mutations, each one applied to the shipped code, run,
and reverted:

| broke | test went red |
| --- | --- |
| default back to `jobs[0]?.id` | 5 of 8 composer tests |
| default to the FIRST active job instead of refusing at two | 3 (pure + composer) |
| count COMPLETE as an active status | 10 |
| `?job=` no longer validated against the company's jobs | 1 |
| page stops spreading the filter into the report query | 1 (source scan) |
| keep nothing across a submit — the old full reset | 2 of 3 time-entry tests |
| keep `hours` too | 1 |
| drop the composer's empty-job submit guard | 1 |
| remove the "Choose a job…" placeholder option | 2 |
| drop the new filter from the job-picker census | 2 |

What the tests CANNOT see, said plainly: `/field-reports` is a server
component that queries Postgres, so nothing here renders it, and the query's
`where` is out of reach of a unit test. That half is a source scan over the
page file, and per the rule this repo learned from the scratch-cleanup guard
it asserts what it read — the file is over 2000 characters, still declares
`FieldReportsPage`, still calls `dailyFieldReport.findMany` — so a pattern
matching nothing fails loudly instead of passing everything. happy-dom also
does no constraint validation, so `required` on a select whose selected option
is empty is asserted through the component's own guard rather than the
browser's.
