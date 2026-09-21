### Today is the phone's day, not UTC's (Diego)
`diego/schedule-local-today`

Found on a device the hour Gap 5 shipped, which is the only place it
could have been found. At 18:03 in Albuquerque the UTC date is already
the 21st, so the schedule screen drew **today** as "2026-09-20 · past"
and — worse — the server agreed it was over and reported no hours
against it, which the screen rendered as **"No hours logged"**.

That is precisely the accusation the future-day rule exists to prevent,
aimed at a day still being worked. `hoursLogged` is null for a day that
has not happened yet for exactly this reason; the bug was that the
server decided "has not happened yet" in UTC.

The web has carried `components/localToday.ts` since a foreman filing an
incident at the end of a shift dated it a day late. The phone had no
such helper, so it grew one, and the schedule endpoint now takes
`today` from the caller — the phone's calendar date, always sent — with
UTC only as the fallback for a caller that does not.

Mutation-tested: making the route ignore the viewer's day turns the new
dbtest red, and it is the case that matters — the same planned day reads
as "nobody logged hours" when the viewer has reached it and says nothing
at all when they have not.
