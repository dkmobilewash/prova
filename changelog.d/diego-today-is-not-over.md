### Today is not over, so nothing is claimed about it (Diego)
`diego/today-is-not-over`

#393 made the schedule ask the PHONE what day it is instead of asking
UTC. Correct, and not enough: with the right day in hand the server
still answered "no hours logged" for **today**, because only a day
strictly in the future was treated as unanswerable.

The question this field exists to ask — was a planned day worked without
a timecard — can only be asked about a day that is OVER. At 18:03 a
foreman has not filed today's hours yet, and telling him he has not is
an accusation about a shift he is still working. `hoursLogged` is null
for today as well as for the future now; only `date < today` is a fact.

**The test I wrote for #393 asserted the bug.** It said, in as many
words, that a planned day with today's date should come back `false` —
encoding the accusation it was written to prevent. It passed, it was
mutation-tested, and it was wrong. Caught by reading the live endpoint's
answer for a real day on a real job rather than by anything that runs:
`today=2026-09-20` still returned `hoursLogged: false` for 2026-09-20.

That is worth more as a warning than the assertion is as a check. A
test can only defend the behaviour its author already understood, and
mutation-testing proves the test NOTICES a change — never that the
behaviour it pins is the one anybody wanted.
