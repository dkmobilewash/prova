### The Ask box logs hours for the day they were worked, not only today — phase 4e (Diego)
`claude/prova-ai-task-completion-96pjes`

"Log 8 hours for Mike on Riverside" worked. "…yesterday" did not: the
command hard-coded `ctx.today` and its own description told the model to
send people to the job page for any other day. A foreman logs yesterday
at the truck as often as today — Friday's hours on Monday morning is the
ordinary case, not the exception — so the one command a field tier
actually reaches was the one that could not record the week it had just
worked.

**The day is the person's words, read backward.** `parsePastDay` in
`lib/ask/dates.ts` joins `parseDateWords` rather than replacing it, and
the two disagree on purpose. A schedule moves into the future, so a bare
"Tuesday" there is the next one; a timesheet looks at the week behind
you, so the same word here is the Tuesday just gone. "Last Tuesday" is
the one before that, a bare weekday matching today IS today (a foreman
saying "Tuesday" on a Tuesday means the day he is standing in), and a
month-day with no year is this year with no chip row — the schedule
offers both years because both are live plans, and a record of something
that happened has only one reading. The test pins the disagreement
itself, not just the backward answer: a pair of assertions per case
showing the two parsers return different days, so quietly pointing the
timesheet at the forward one fails even on a day where they coincide.

**A future day parses and is refused by name.** Returning null for
"tomorrow" would make it identical to "bananas", and they are not the
same problem: one is a date this app can read and will not accept, said
as "Sep 9, 2026 (Wednesday) hasn't happened yet"; the other is a
question back quoting the words. A day more than a fortnight back is
logged with a warning naming how long ago it was, because payroll for
that week may be filed — but not refused, since the hours were still
worked and a refusal is how they go unrecorded.

**What the tests caught, which is the part worth reading.** The database
case was first written asserting that a second card for a day already
logged is refused, on the assumption that the action treats one
person-job-day as unique. It does not, deliberately: several entries for
one person on one day are ordinary (different craft codes, different
cost codes), and the guard is a ten-second identical-row double-click
check. The first version passed a different figure and would have gone
green against a rule that does not exist — the vacuous-check shape this
repo keeps paying for. The case now taps the SAME card twice and gets
the action's own sentence, then logs a different figure on that same day
and gets a third row, which is what proves the refusal was the guard
rather than a uniqueness rule nobody wrote.

Two eval cases grade the thing that actually breaks here: that the model
passes "yesterday" and "last Tuesday" THROUGH as words. A model that
helpfully converts them to a date is the failure, since it does not know
what day it is where the person is standing.

The card's date line gained the weekday (`dayLabel`) and says "today"
only when it is today; the command is "Log hours" rather than "Log
today's hours"; `updateTimeEntry` stays excluded, because correcting
payroll evidence still belongs in front of the row being altered.

Verified: 21 parser cases and 15 command cases against fixed todays,
13 database cases through the real tap against a real Postgres 16, and
the full unit suite, typecheck, lint and build. Nobody has clicked it;
the click list is in the PR.
