### Round 10b: a sheet's real scale offered first, and the answer-key tool's save and restore fixed

- A sheet with several drawings now offers every plan's caption scale, including a finish or ceiling plan, with the most-drawn plan first. Clerk of Courts A-601.3 was set to 1/2" because the only scale offered was a marble-base detail's; its Floor Finish Plan at 1/8" was dropped as "not a plan". Finish plans are still left out of the wall count. A set's stored scales change only when its sheets are read again.
- "Save as answer key" now counts as a save. Before, the browser draft stayed, and the leave-page warning stayed armed. An automation browser dismisses that prompt, which cancels the navigation, so no other job's URL would open.
- Reviewed by is in the box on the first render, so typing no longer doubles a name that arrived late. A saved file's name is never dropped into a box that has focus.
- "Save to labels" saves a trace-only sheet (no candidates, no pairings). It refuses only a sheet with nothing decided and nothing traced.
- A draft with a split restores. The draft now carries its splits, and restore makes them again before comparing the candidate list.
- The help and the rules say partial-height walls count.
- The viewer says "Opening the set…" while the PDF opens, and stops saying "Drawing…" as soon as the sheet is painted, not after its words are read.

Check: `pnpm test:e2e -- --takeoff-click -g "K\d+ "`.
