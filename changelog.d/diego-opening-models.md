### A learned door scorer: 28 unmarked doors clear the 97% line under leave-one-set-out (Diego)
`diego/opening-models`

METHOD v2 on the opening table from #1168. `scripts/opening-model/loso.py` trains real-vs-false scorers,
scores each training set with a model that never saw it, and finds the lowest score whose pooled precision
is at least 97%. Doors (6 training sets, 208 found, 195 real): the line is 0.999; 40 clear it at 97.5%, 28 of
them unmarked (27 real, 1 false), so the model with today's marked-door rule posts 76 at 97.4% against 48 at
97.9%. Windows (255 found, 90% real): no line reaches 97%, and the model's top scores are worse than the base
rate, so no window model ships; today's signals are strong on training (counted by tag 97.7%, #1165's drawn
count 59 of 59). `models/door-model.json` is in the product's `gbdt-binary-v1` format with its `autoLine`;
nothing reads it yet. The model census holds a file marked `kind: door` to the door columns. Window features
v2 keep #1165's drawn count (`countedDrawn`) apart from a tag's, and the table reads the window-count eval's
cached schedule reads (`OFT_SCHEDULE_CACHE`), so a set tagged by schedule letters (Topeka) reads as the product
reads it. Check: `wallModelColumns.test.ts` (a door model with a dropped column goes red) and
`openingFeatures.test.ts`.
