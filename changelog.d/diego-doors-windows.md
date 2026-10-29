### Doors and windows from the plan itself, behind a switch

**Why.** Togal counts doors and windows off the drawing; this app found a
doorway only as a gap in a wall face, measured a fifth narrow, and never saw
a window at all.

**What.** `Company.doorsWindowsOn`, OFF for everyone, under Settings →
Estimating. With it on, Find the walls also reads the door swings off the
sheet — a quarter-circle fitted to the short straight pieces CAD exports
(not one swing on four training plans arrives as a curve), with the leaf's
radius as the door's width — counts them, pairs double doors, places each on
its wall run, and names it from the door schedule when a mark sits beside
it (the second session's join). Windows — frame, glass, frame across an
exterior wall — are listed as "to check". Measured against keys built from
the plans' own marks and cached schedule reads: 82 of 82 doors on four
training plans, no false, 25 of 25 schedule widths within an inch; windows
found where a plan has them but with 25–32 false on plans that have none,
which is why they are offered and not counted. `lib/takeoff/NOTES-doors.md`
has the table and what each number is worth.

**Check.** `doorWindowSymbols.test.ts` (swing + leaf, no leaf, radius and
sweep rejects, pairs, drawn-twice), `doorsWindows.test.ts` (schedule rows),
the switch's db test, and `realplan/doorWindows.eval.ts` against the keys
outside git. Migration additive (one boolean). No e2e run.

**Round 2.** The detected doors feed the rest: each run's openings are now
the doors' widths rather than the inferred gaps, and a named door's schedule
height rides into the saved run. The room engine takes the doors as seals;
measured before and after on Baker, Bunkie, Joplin and the BIM arm, the
seals change nothing because the gap rule already closed every doorway a key
room sits behind (NOTES-doors.md §5). Windows: a face-coverage rule cut
Crosslines' false by half; Baker's 33 false stayed and the target precision
was not reached, so they remain "to check" (§7).
