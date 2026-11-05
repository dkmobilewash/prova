### The answer key records which type each wall is, for round 12

Round 12 needs a key for wall TYPES, and the answer-key tool could store only whether a line is a
wall. Now, once a wall is accepted or traced, the panel offers the set's legend codes. These are
the stored WALL_LEGEND read, the same vocabulary the finder names walls with, read with no model
call. Number keys 1–9 pick a code, 0 says "can't tell" (U), and a box takes a code the list lacks
(Joplin's composed A3, or any set whose legend was never read). After each pick the panel moves
to the next untyped wall, so a sheet is typed from the keys.

The type is saved as `wallType` on the verdict and the trace in the label file, with no schema
change. It survives reopen, the unsaved draft and the merge of carried decisions. A rejected wall
or a removed trace loses its type. `keyFromLabels` hands it to the scorecard (`ScoredRun.wallType`)
so "typed correctly" can be graded by footage over the walls with a type other than U.

Tests: `wallTypeLabels.test.ts` (state, file, restore, draft, reader) and the panel's picker, keys
and save payload. Dropping the field at the writer, the restore, the save payload or the reader
each turns a test red.
