### The foreman signs the day, the office approves it, and a signed day's hours are locked (Diego)
`diego/timesheet-signoff`

Until now a logged hour was a typed number that anyone could change at
any time, which makes it a note rather than payroll. The last part of the
Gap 1 audit ("time entry is a typed form, not a payroll instrument").

- **Sign the day (phone).** On a job's Time screen, next to Log time. It
  lists that day's entries and hours, takes a printed name and a drawn
  signature, and goes through the offline queue like everything else.
  One signature covers everyone's hours on that job for that day.
- **Locked until reopened.** While a day has a live sign-off, no entry on
  it can be added, corrected or removed: not from the phone (409), not
  from the web form or row, and not by a direct write. The rule is a
  database trigger, `prova_time_entry_day_lock`. The app checks first so
  people get a sentence rather than an error.
- **Approve / Reopen (web).** Under Field time entries on the job page,
  with the signature drawn in. MANAGE_COMPLIANCE, the capability that
  already owns certified payroll. Reopening asks why, and keeps the old
  signature and the reason on the record. The foreman then signs again.
  Sign-offs are append-only (`prova_timesheet_signoff_lock`). What was
  signed cannot change, and approval and reopening are each recorded
  once.
- **T&M tickets take a drawn signature.** The client signs in a box on the
  phone, with their name printed under it. The job page now lists the
  job's T&M tickets with the signature, and older typed-name tickets say
  so.
- **The phone's queue no longer stalls on a refusal.** A 4xx that retrying
  can't fix (a signed day, an archived crew member) used to sit at the
  head of the queue forever, holding every later write behind it. It is
  now set aside, and the screen shows what wasn't saved and why.
- **Archive a crew member (web, Team page).** Crew members are now listed
  on the Team page, and the owner can archive one in two steps. There was
  no way to do that before. Their hours and their name on past payrolls
  stay as they are; they just stop being offered for new hours. There is
  still no delete, on purpose.

Migration `20260918230000_add_timesheet_signoff`, additive: one table, one
nullable column on TmTicket, two triggers. No existing row is touched, and
no day is locked until someone signs it. Cleanup scripts delete sign-offs
before time entries, because a live sign-off blocks those deletes.
