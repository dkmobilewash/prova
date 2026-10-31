### The contractor walk, round 2: board layers, Send to GC, wall types, and two more phone screens (Cyrus)
`test/walk-round-2`

`bid-contractor-walk.spec.ts` now walks, in CI's signed-in `e2e` job, the parts that nobody had
clicked in a browser:

- **Starters (step 4b).** Bid's starter wall types are added if any is missing. The walk prints the
  list the button offers and soft-asserts that it never includes the CRM-only flooring, paint or
  concrete. It also opens W1's card and prints the "Board layers each side" answer and each part's
  "Per layer" box.
- **Board layers (step 5b).** The takeoff now prices its found walls as W1 instead of plain
  measurements, so the guide can ask "How many layers of board are on the W1 walls…". The walk
  prints the wall-schedule lines, taps "2 layers each side", confirms, and prints them again. It
  soft-asserts that board and hang doubled (give or take one rounded-up sheet) and that studs,
  track and tape-and-finish did not move. When the question is not asked, it prints which link was
  missing: the starter, the walls, the type they were added as, or an earlier ask.
- **Send to the GC (step 8).** On the second GC's proposal the walk prints the "Send to" box: the To
  choices as address shapes, the subject, and the refusal. It soft-asserts the "only emailed from
  the live app" sentence and that no send button is drawn. It never presses one. With no GC picked,
  it checks that each per-GC "Send to" link stays inside `/bid`.
- **Wall types after the walk (step 10b) and phone width (step 11).** The wall types page is printed
  again after the answer, and step 11 adds the bid log and wall types at 375px.

The earlier steps were brought up to date with today's UI:

- "Start the estimate" is pressed on the row.
- "Same job as…" is picked first, and the name and trade it fills in are printed and checked.
- The second GC gets a test email address, so the Send box has someone to offer.

Answering the layers writes W1's layer count company-wide on the shared TAKEOFF persona. No other
spec asserts a board quantity.

NOT EXECUTED where it was written; checked with:

- a typecheck, with a control error proving the checker saw the file;
- eslint;
- `playwright --list`;
- the `e2e/lib` suite and the tests that read specs.

The first run is the `e2e` job.
