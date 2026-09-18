### A refused save on the crew schedule no longer wipes what you picked — and two build checks for this week's two bug types (Cyrus)
`cyrus/form-and-export-census`

**The crew schedule.** "Put someone on" submitted through `<form action={…}>`.
In React 19 that prop resets the form BEFORE the action runs, whatever it
returns (`startHostTransition` → `requestFormReset` in react-dom-client), so
"they are already on that job that day" arrived next to a form that had
snapped back to the first job, the first worker and today. Now `onSubmit` +
`preventDefault` + `new FormData`, reset only on success.
`crewScheduleBoard.test.ts` renders the board, forces a refusal and checks all
five fields survive; it went red on the old code (job read `job-a`, not
`job-b`) before the fix.

The same form's date parser accepted `2026-02-30` — `new Date` rolls it to
2 March without complaint, so a typo planned somebody for a day nobody chose.
`workDateFromString` now round-trips the date the way `emrEffectiveDate`
does. Red first on `2026-02-30`.

**Census 1 — `components/formActionCensus.test.ts`.** Every client component
in the workspace is scanned for a `<form action={…}>` or `formAction={…}`;
anything not in `KNOWN_EXCEPTIONS` fails the build. On its first run it found
the same bug in four more forms: `CompanyLicenses` and `PhaseCodes` (fixed
here) and `JobDetailsForm` and `CompanyProfileForm` (mostly Diego's — listed
as exceptions and reported on #311, alongside `QuickBooksMapping`). Three
more are listed as harmless because their forms hold no typed fields. The
exception list carries a count per file and fails when it goes STALE, so a
fixed file cannot keep a free pass. Its scope is proved, not assumed: the set
of client modules it walks must EQUAL what `git grep` finds by a different
method. Mutations, each red: crew board reverted; `PhaseCodes` reverted;
walk narrowed to `apps/web/app`; file pattern narrowed to `.ts`; comment
stripping removed (tripped on 11 comments quoting the old pattern).

**Census 2 — `lib/exportCompletenessCensus.test.ts`.** Every `model` in the
schema must be in exactly one of: an export dataset, `EXPORT_OMISSIONS`, or
the new `EXPORT_INTERNAL_MODELS` (counters, sync logs, notification rows, AI
usage — each with a reason). Three tables in one week (#306, #307, #308)
shipped in none of them and were only caught by a reviewer. `CrewScheduleDay`
was not caught at all — it is now an export dataset. The first run also
found signed T&M tickets, the outbound message log, phase codes, apprentice
period sign-offs and photo tag assignments — now disclosed on the export page
rather than silently absent. The parse is counted against an independent
line count (101 = 101). Mutations, each red: fake model added to a schema
file (also with odd spacing); an internal entry deleted; the crew dataset
repointed; a model double-claimed; the regex broken to match nothing.

Not run: `test:db` (needs a scratch database; none on this laptop). The new
crew-schedule dataset's ten columns were instead checked against the
generated client's `Prisma.CrewScheduleDayScalarFieldEnum` — none missing —
but no export query was executed.
