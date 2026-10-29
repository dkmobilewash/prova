### What actually changed, in plain English (Diego)
`diego/classifier-signals-2` (supersedes `diego/classifier-signals`)

**Ten census signals in the wall classifier, and the pen's colour on every
stroke.** The four from the first round (words between the faces, dashed
faces, runs meeting, twin faces) and six more: the faces' stroke colour as
luminance with a flag for its absence, 45° ticks that cross a face, a
dimension number centred on the run, extension lines reaching the run's
ends, and parallel faces at cabinet depth (20–28 in) along the run — the
casework signal, a feature rather than the set-aside `diego/casework` tried,
which was 6.8:1 on training and 1.6:1 on the held-out delta. `StrokeSegment.gray` carries the colour from the PDF through
save/restore and the unit change. Appended to `FEATURE_NAMES`, so an older
model file stops applying rather than misreading a column.

**The classifier evals honour #843's excluded sheets.** `zzLoboVeto` and
`zzDemote` skip a sheet `excludedSheetReason` names (Michigan A3's traces are
existing walls), so it neither trains nor grades the model; `zzDemote` also
grew `DEMOTE_HELD_OUT=1`, which scores the held-out sets for a before/after
delta of one model against another and nothing else.

**What ships is the 28-column model, retrained with round 8.** Measured
at cut 0.2 on the same 30 training sheets (leave-one-building-out) and the
held-out sets (delta only): 804 ft of junk greyed for 194 ft of real at 81%
precision on training, 579 for 145 at 80% held-out — against the current
model's 716 / 239 / 75% and 311 / 293 / 51%. The six new signals do not
help (952 / 240 / 80% training, 415 / 136 / 75% held-out; dimension-line
junk greyed falls from 210 to 145 ft), so they stay as measured inputs and
not as the model's columns. Numbers and per-building tables in `NOTES.md`.
