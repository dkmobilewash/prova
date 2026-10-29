### Four census signals in the wall classifier, and the classifier measured as the estimator meets it (Diego)

`diego/classifier-signals`

The feature vector grows by four columns, appended so an older model file is refused
rather than misread: `wordsBetween` (non-dimension words between the faces along the
run), `dashedFaces` (0, 1 or 2 faces that are dash patterns, from the raw strokes),
`runsMeeting` (perpendicular faces ending on the run) and `twinFaces` (parallel faces
of the same length elsewhere on the sheet). The pairing loop gets the sheet's words and
raw strokes through two new finder options to compute them. The clip-path share was
NOT added: `diego/junk-rules-2` removes those strokes outright, so the signal would be
identically zero the moment it merges.

`zzDemote.eval.ts` measures a model the way the app applies it — `modelVerdicts` at the
0.2 grey-out cut on the product path, leave-one-building-out — and reports the numbers
an estimator feels: of the greyed lines, the share the labels call junk; the share of
all junk greyed; the real wall greyed in feet. A model whose columns are a prefix of the
build's is scored on that prefix, which is how the old model is compared at all.

| at 0.2, training sheets | greyed | junk greyed | real greyed | precision |
| --- | --- | --- | --- | --- |
| new, 28 columns, LOBO | 193 runs, 1,331 ft | 1,073 of 12,710 (8%) | 146 ft | 88% |
| old columns, LOBO | 216 runs, 1,139 ft | 944 of 12,806 (7%) | 163 ft | 85% |
| shipped file (trained on these sheets, so flattered) | 210 runs, 1,298 ft | 1,074 (8%) | 189 ft | 85% |

The new model beats both on precision and on real wall greyed and ties the shipped one
on junk; neither target is met (90% precision, 40% of junk), because at 0.2 a run is
greyed only when EVERY pairing of it scores under the cut — 193 of 4,032 runs. The
model file is prepared beside this branch (`train-…-signals/wall-model.json`, `cut`
0.2) and ships only together with this code.
