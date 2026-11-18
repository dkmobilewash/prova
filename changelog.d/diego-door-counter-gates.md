### A 2 ft door leaf hung in no wall is a counter gate, not a door

Sloans A1.1 draws two pairs of 2'-0" double-swing gates in its service counter, beside "COUNTER FRIG.", and all four were counted as doors to take off. A found single leaf no wider than 2.1 ft that sits on no wall (`counterGate`, `doorsWindows.ts`) is now not counted; a 2'-0" closet door hangs in a wall and is kept.

Measured alone against the doors precondition ship state (labels-snap-20261118T1020): training false 68 → 63 (Sloans A1.1 5 → 1, Garden Square A100 7 → 6, its architect's seal), matched 593 unchanged; retired pool identical; no set worse. No real door in either pool has a single leaf under 2.3 ft off a wall. Check: `doorsWindows.test.ts` "a 2 ft leaf in no wall is a counter gate" — dropping the wall condition, or the filter's call in `doorsInScope`, reds it.
