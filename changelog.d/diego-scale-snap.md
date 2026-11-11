### Scale snap: the standard scale the dimensions agree on is offered, one click per sheet (Diego)
`diego/scale-snap`

Bluetooth's AI101 CONSTRUCTION PLAN (pages 6 and 7) read no scale. 18 dimensions agree on 1/8"
within 1%, most of them exactly, but they are short (108 pt, under the 130 pt calibration floor).
The one long enough is 0.74% out, over the 0.5% a measured line may carry, and the title block's
scale is not in the text layer. So the sheet could not be taken off without a hand-set scale.

- When several dimension readings cluster within 1% of one standard scale (at least as many as
  a vote needs), and no second scale contradicts it, the reader offers that standard scale. It
  is never set silently: the inventory stores it unconfirmed (`DIMENSIONS_SNAP`), last, after
  the measured line, the reproduction check, the printed scale and the per-view scales. So a
  sheet that reads a scale today reads the same one.
- The plan set and the review queue show it as **Use 1/8" (from 18 dimensions)** on that sheet.
  Confirm scales and "Use the printed scale on all" never take it; it is saved only by its own
  button, and its note says how many dimensions agreed.

Measured with `lib/takeoff/realplan/scaleSnap.eval.ts` on the 43 labelled training sheets: 41
read a scale today, all 41 right and unchanged; 2 decline, both onto per-view scales, so neither
gets a snap and none is offered. Bluetooth (not labelled): pages 6 and 7 are offered 1/8"; every
other page reads what it did. Checked by `takeoff-scale-snap.local.spec.ts` on Bluetooth
(mutations: a snap treated as a printed scale, and a snap stored as a confirmed reading, each
fail their step).
