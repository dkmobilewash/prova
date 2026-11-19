### A saved split reopens as the same split (labelling tool)

Chrome Round 31: Mid-City A4.0–A4.3 were split and saved correctly. On reopen,
some split runs came back whole and unreviewed (A4.1 re-applied 10 of 16
recorded splits). The finder had not moved them. `reapplySplits` gave each
record to the first candidate that was parallel, near the line and of similar
length, without checking where along the line it sat. Mid-City repeats its
units, so that was often a same-length twin 85–122 ft further along the same
grid line. The cut fell off the twin, so the split was declined.
`candidateFor` had the same blind spot: a reviewed half could land on a twin
100 ft away.

- A recorded split now goes to the candidate whose ends lie within 1.5 ft of
  its own (nearest wins). It survives small end moves and renumbered ids. A
  saved decision must also overlap its candidate along the line.
- Every reopen and save used to write each re-applied split twice
  (`state.splits` plus every recorded split). Now each is written once
  (`splitsForSave`), and existing duplicates collapse.
- A saved decision that still cannot be re-attached is kept and written back
  unchanged. The candidate under it reads "needs a look", and the counter no
  longer counts it as unreviewed work.

Labelling tool only (inert in every deployment). The customer-side finding
from the same investigation, a finder deploy undoing kept/dropped decisions
through `refreshSheetWalls`' exact-coordinate re-attach, is logged separately
and is not in this change.
