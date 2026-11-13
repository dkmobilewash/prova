### The keyless legend read finds more of the set's own codes, off until the held-out sets decide (C3)

Both learned type models failed (choosing among codes, and keeping or dropping
the rule chain's answer), and the reason was upstream of them: on the 22b
training keys the true code was **not a candidate for 48% of key-code feet**.
A probe (`zzLegendRecall.eval.ts` + `scripts/type-model/recall.py`) named the
cause per code. Two were general layouts the text read did not know:

- a detail titled **"PARTITION - 0S3"**, with no word TYPE (cmb's whole legend
  page read nothing);
- one printing that **lists several codes** sharing a detail ("A1 A2 A3 A4",
  and the sound-wall variants "A1A A2A A3A A4A" on Pottawattamie).

Both are read now, behind `LEGEND_TEXT_RECALL=1` (on top of
`LEGEND_TEXT_READ=1`). Training, the types table gate off vs on, today's chain:

| | off | on |
| --- | --- | --- |
| candidate recall (key-code ft) | 51.6% | 69.1% |
| settled-correct | 38.5% (5,701 ft) | 38.9% (5,769 ft) |
| wrong-of-typed | 24.3% (1,875 ft) | 15.5% (1,090 ft) |

Only two sets move: Pottawattamie (790 wrong ft gone) and cmb (+68 right,
+5 wrong). A third fix was tried and dropped whole: putting the plan's
suffixed tags (UCCS's P0A6A beside the legend's P0A) in the vocabulary stopped
the tag reader typing them as the family's variant (`familyOf` only reads tags
NOT in the vocabulary), and UCCS went from 923 right feet to 0.

**The held-out test was written before Round 23's keys existed**: candidate
recall up AND wrong-of-typed <= 10% with the gate on, on the new held-out sets
only, run once (`TT_HELD=1` table, `measure.py`). Training sits at 15.5%, so
that bar is not a formality.
