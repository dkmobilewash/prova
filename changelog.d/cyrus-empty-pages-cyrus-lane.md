### Safety gets a real empty state, three list pages stop saying "nothing" three times, and the schedule stops being a wall (Cyrus)
`cyrus/empty-pages-cyrus-lane`

Cyrus's complaint about these pages was that they "look empty", and his
eye was measuring something real: how many times a page says "nothing",
and whether it gives you anything to press.

- **`/safety`** printed "No cases logged for 2026." twice in a row, the
  status line and then the paragraph under it, and it was the only field
  page with no example of what it becomes. A company that has never logged
  a case now gets one `EmptyState` with a marked example (three cases, with
  the same `2026-NNN` case numbers the real log uses) and the page's own
  Record an incident button as its primary. Toolbox talks get their own.
  A company whose only cases are in earlier years gets one plain sentence
  for this year and no teaching example. The status line comes back with
  the first case. `/safety` is off `EMPTY_STATE_EXCEPTIONS`.
- **`/rfis`, `/submittals`, `/drawings`** stacked three empties on a new
  account: the status line, then a "0 in play · Show closed" header, then
  the `EmptyState` title. Both lines above it now wait for the first
  record, the same way `/bids` already hid its count. A company WITH
  records keeps both even when the current filter shows none, and the test
  renders that case too.
- **`/schedule`** with a job and no crew hid "Put someone on" and left a
  box with nothing to press, which is where getting-started step 5 sends a
  new owner. The box now says there is nobody to put on yet and links to
  Team.

The check is `app/(app)/one-empty-sentence.test.ts`. It renders each page
on an empty database and on one with records, counts the "No cases"
sentences, and requires the status line and the count on the account that
has data. Mutation-tested: putting the safety status line and the RFI
count header back unconditionally turns three cases red. The schedule
link has its own cases in `crewScheduleBoard.test.ts`.
