### The scanned answer key is held out before a label exists (Diego)
`diego/scanned-held-out`

8102 Evergreen BLDG D is the first scanned set in the corpus, and from today
it is the scanned pipeline's test: p24 (A242B) and p27 (A244A) will be
labelled on the next Chrome round and must never become training rows. So it
goes into `HELD_OUT_SETS` now, with no label written yet — the same ordering
#832 used for round 8 — and `heldOutSets.test.ts` refuses it by its real
file name and by its underscored directory spelling.
