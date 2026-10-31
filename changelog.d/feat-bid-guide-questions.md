### C Stream Bid asks the questions the drawings don't settle, and says what the bid's dates and papers need (Cyrus)
`feat/bid-guide-questions`

The guide picks the ONE thing a bid needs. It now has four more things it can
say, all written by code from the job's own rows:

- **"How tall are the W2 walls on Civic Center?"** with tap answers (8, 9, 10,
  12 ft) and "Another height" into Bid's wall-type library. A run with no
  height on a wall type with no default height produces NOTHING in the
  estimate — not the board, not even the track — and the guide could not see
  it: every price ask reads lines, and those walls have none, so a job could
  fall through to "proposal ready" with walls missing from the number. Asked
  after the walls are measured and before they are added or priced. Height is
  the only input to the wall arithmetic that can be missing (`sides` and stud
  spacing are never null; `thicknessIn` matches detected walls to a type and
  changes no quantity), so it is the only one asked. The answer goes through
  the existing `updateWallType` (the type's default height, every other field
  as it stands) and then the existing `refreshWallSchedule` for that job, with a
  confirm that says the height is the wall type's. The argument is re-derived
  server-side and refused when stale (a run added or sized since), and a tag
  `updateWallType` would rewrite (a schedule's lower-case "W2a") is refused
  rather than silently renamed — found by the db test, not by reading.
- **"The job walk is tomorrow at 9:00 AM."** and **"RFI questions are due
  Wednesday."** inside two days, first in line, because they pass on their own
  and nothing can make them up later — except when the bid itself is due inside
  48 hours, where the bid's own ask wins so a blocked bid due tomorrow still
  says what blocks it. On the home list they rank just under a blocked bid.
- **"Addendum 2 was issued Tuesday and isn't acknowledged on Hartwell's bid form
  yet."** — per GC form, read through `bid-papers.ts`, asked once the bid is
  priced and before "open the proposal" or "send it now".

Checks: one fixture and one priority boundary per new ask in
`buildJobGuide.test.ts`; action tests for stale, wrong company, both
capabilities, an unoffered height and the rename guard; `facts.dbtest.ts` and
`bidGuideWallHeight.dbtest.ts` against a real Postgres (per-GC acknowledgement
from the column and from rows, a legacy project-less addendum, another
company's walk and addendum invisible, the walls becoming lines after a tap).
