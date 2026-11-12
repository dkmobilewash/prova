### A scale snap is never set without its own click (Diego, via Chrome)
`diego/snap-never-auto`

Bluetooth AI101 (pages 6 and 7) showed "Scale set: 1/8"" with nobody having pressed anything. The
local labelling scripts (`set-review-scales.mjs`, `sheets-for-set.mjs`) turned every stored
reading that had a line into a calibration, and a scale snap (#1126) has one: the page width at
the standard scale. So the offer was applied, noted as if read from a measured dimension.

- Both scripts now leave a `DIMENSIONS_SNAP` reading for its button and say so.
- In the product, `applyPrintedScales` ("use the printed scale everywhere" in the sheet tree, a
  press that sets many sheets) skips a snap and names it: "its scale is offered from the
  dimensions: use the button on this sheet". The only path that sets a snap is still
  `confirmSheetScales` with that one page, from its own "Use 1/8" (from N dimensions)" button.
- The viewer's note for a snap filled into the scale form says what it is: "18 printed dimensions on
  this sheet agree on 1/8" = 1'-0" within 1%", not "printed on this sheet".

Checked by `takeoff-printed-scales.dbtest.ts` (a snap page among the named pages is skipped; with
the guard removed it is set and the test fails).
