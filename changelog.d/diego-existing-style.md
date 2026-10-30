### What actually changed, in plain English (Diego)
`diego/existing-style`

**A census of how training sheets draw existing walls against new, with no
words, and the one convention that holds.** For every offered paired run on
the training sheets, its verdict by the cleaned labels and its drawing style
(filled or outline, fill grey, pen grey and width, dashed, hatched, layer),
per sheet and per split (`realplan/zzExistingCensus.eval.ts`, keyless).
Fill against outline is the biggest convention by footage and runs BOTH
ways — Camp Bow Wow and Bunkie draw the existing building outline, Joplin
and ELEVEN03 draw new partitions outline — so as a rule it fails nine
buildings and is not built. Grey pen against black is the one that holds
per building, and only light (≥ 0.6) with a real share (≥ 20% grey and ≥
20% black of the sheet's paired footage): a new `existing` route sets the
grey walls aside on such a sheet and never on a sheet drawn in one pen. It
fires on two training sheets, Baker A100 and E Street A2.1; the 53-sheet sweep against its base on the cleaned keys is 889 ft of junk removed for 34 ft of real lost on training (Baker 651 / 34, E Street 238 / 0, nothing else moves) and, on held-out as a delta, −922 junk for −334 real.
Thin evidence, recorded as thin; the sets to add are renovation plans with
a stated graphic convention. Details in `NOTES.md`.
