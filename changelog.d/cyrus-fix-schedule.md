### The schedule becomes a week, crews go on in one save, and hours get totals (Cyrus)
`cyrus/fix-schedule`

Three findings from the contractor-persona UX tests (COMBINED #6; medium-B
#1, #2, #8–#12; full-C C1–C5), fixed without a schema change.

**/schedule opens on a week board.** Jobs down the side, Mon–Sun across,
names in the cells, prev/next week, today's column marked, the week in the
URL (`?week=YYYY-MM-DD`, any day names its Monday). The old two-week list
stays underneath as the secondary view, with "Mon, Oct 19" instead of raw
ISO. The page now uses the VIEWER'S day (`viewerToday`) rather than the
server's — a day planned for "today" on a Sunday evening in the US was
already "yesterday" in UTC and dropped out of the list. Check: open
/schedule on a Sunday; today's column is highlighted and a row saved for
today appears in it.

**One form puts several people on a job for a date range.** Checkboxes for
who, start and end day, "Skip weekends" on by default; one `createMany
… skipDuplicates` in one transaction, so a second identical save creates
nothing and says so ("3 already there"). The result names who, where and
which days. Double-booking is a WARNING in the same message, never a
refusal: the same transaction reads any row for those people on ANOTHER job
those days and names the person, the other job and the day. Check: put two
people on Mon–Fri, save again, read the counts; put one of them on a second
job for Wednesday and read the warning.

**The form stops saving on Enter.** Pressing Enter after picking a job used
to submit with the default person and today, with no message
(`blocksImplicitSubmit`). Only the button saves, and a saved line renders
afterwards. COMPLETE jobs are out of the picker, there is no default job,
and the last-used job is remembered for the next save. Check: pick a job,
press Enter — nothing saves.

**The job's Crew tab can schedule.** "Who is on this job" shows the same
week grid filtered to the job, and "Schedule crew" opens the /schedule form
with that job preselected (`?job=<id>&add=1`).

**Hours get totals.** The Crew & time tab opens with "This week: N hrs" and
a person × day grid with row and day totals, above the existing cards.
`/hours` shows the same grid across every job for one week plus a by-job
block, linked from Crew & field (whose tool card reads "N hrs this week")
and the Daily work rail group. Read-only aggregation in
`lib/weekly-hours.ts`, hours only, no wage cost; payroll export untouched.
Route is open on the same reasoning as `/jobs/[id]/crew`, recorded in
`permissions.test.ts`.

**Not done, on purpose:** saved NAMED crews ("Crew 1 — framing") need a
table and so a migration; the proposal is in the PR description for Diego
to see before anything is announced. The checkbox list covers "5 people,
Mon–Fri" today in one save.
