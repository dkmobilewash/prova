### Time entry now clocks in and out, instead of typing a date and hours (Diego)
`diego/time-entry-clock`

A foreman's day is a clock, not a form. Until now the only way to record
hours was a text field for the date and a text field for the hours, so the
phone could not say when a shift actually started or stopped — no breaks,
no start/stop times, no way to split a mixed-craft day except retyping it.

`TimeEntry` now carries three nullable capture-evidence columns —
`clockStartedAt`, `clockEndedAt`, `clockBreakMinutes` — written once at
create and never corrected. The phone computes DURATION only (end minus
start, minus the unpaid break); `hours` stays the authoritative figure and
pay type stays entered by a person, so the OT split is never derived on the
phone. The existing identity-lock trigger is widened to refuse a rewrite of
the captured clock, the same way it refuses reassigning the person or the
day.

The specific check: `time-entry-correction.test.ts` reads the migration and
asserts the trigger compares all seven locked columns and raises on a
change, and `timeEntryWriteCensus.test.ts` fails if any update names one.
