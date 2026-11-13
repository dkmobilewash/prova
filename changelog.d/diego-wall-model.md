### A learned wall scorer for the runs on offer — passes its leave-one-set-out gate, waits on the held-out exam, wired to nothing (Diego)
`diego/wall-model`

METHOD v2's first wall model. Every run the app offers becomes one row of 50 signals
(`wallRunFeatures.ts`: pen, grey, existing-words, the demolition-plan compare, the pairing
model's own features), built by the product's own detection (`productDetection`, #1169), so
the table is parity rows. A gradient-boosted model (`scripts/wall-model/loso.py`, sklearn,
exported as `gbdt-binary-v1`, scored by `wallClassifier.scoreCandidate`) learns real-vs-not
from 34 hand-labelled training sets.

What ships is the conservative use, REMOVE-ONLY: post what today's rules post, except runs
the model scores below 0.10. Leave-one-set-out on Round 22 labels: 15,305 ft wrong against
17,196 for the hand rules (-11.0%); no set worse by >2 points AND >50 ft (the 50 ft half was
added by Diego before re-reading, because sheets of <=463 ft turn 8 ft into 6.5 points). The
run model alone and the renovation (new-vs-existing) model FAILED the same gate and are not
shipped.

Nothing reads the model yet: there is no product path in this change, so it is off by
construction. It goes live only after the held-out final exam (run once, totals only:
remove-only pooled error below hand's), and only if that passes.

The check: `wallRunFeatures.test.ts` scores 8 invented control rows through the shipped JSON
and requires sklearn's probabilities to 6 places. It caught a real export bug on its first
run — the exported prior was ft-weighted while training was sqrt(ft)-weighted (0.540 vs
0.482); every tree was identical, only `init` was wrong.
