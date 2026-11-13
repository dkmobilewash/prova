### Run takeoff never freezes the tab: the finder runs off the page's thread under a time budget, and three quadratic loops are gone (Diego)
`diego/takeoff-no-freeze`

Broadway duplex A1.0 froze the tab for more than 3.5 minutes, twice, in Chrome Round 22. Its notes and
title block are outlined lettering (552,997 strokes, 45,874 wall candidates), and the finder was
synchronous on the page's thread. Measured in Node, `productDetection` took 357 s:
- `faceIsDashed` scanned every stroke once per candidate (123 s), `runsMeeting`, `twinFaces` and the
  neighbourhood count scanned every face per candidate;
- `tagSymbols` walked each letter's chords in every order until a 4,000-step budget ran out, 554
  million steps for nothing (94 s across two calls).

Fixes, each giving the same answer as before: the wall features read through a grid
(`segmentGrid.ts`), and the tag walk first asks whether any stroke it could reach ends back at its
start, skipping only walks that could not close, then runs the same walk on integer states. On all 54
training sheets the walls, groups, every candidate's features and the tag symbols are identical to
main; detection went from 556 s to 166 s in all (Camp Bow Wow A101 135 s → 15 s, UCCS A2.1.2 67 s →
18 s, Broadway 357 s → 30 s), none slower.

The guard: `timeBudget.ts` puts a deadline inside every heavy loop (`SheetTooSlowError` names the stage
and says to trace by hand), Run takeoff finds the sheet in a Web Worker (`detectOffThread.ts`, 180 s
budget, worker stopped at 240 s) so the spinner keeps turning, and the server's synchronous finder
gets what is left of its 45 s (at least 10 s) and reports "out-of-time" past it. The page rebuilds
`regroup` from plain data (`regroupFrom`), since a function cannot leave a worker. In Chrome, Broadway
now completes (456 ft, 25–30 s on an idle Mac, longer while other jobs run) with the page answering
throughout; the steps after the finder paint between them and log their times. Check:
`lib/takeoff/noFreeze.test.ts` (the walk's step count, the budget, the grid against the scans, the
worker path's walls, groups and regroup); seven mutations each turn it red.
