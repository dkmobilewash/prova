### The sheet's canvas has no size until the sheet is drawn: the lost Set-scale clicks in the e2e suite (Diego)
`diego/canvas-drawn`

Several specs failed now and then because the scale form never opened (takeoff-estimate-chain,
takeoff-workspace, plan-ingest, multi-view). A Playwright trace showed why. The two Set scale
clicks landed about 250 ms before the sheet's PDF had loaded. Nineteen specs wait for
`canvas.width > 0` before clicking the sheet, and a canvas is 300 × 150 by default, so the
wait passed before anything was drawn and the clicks hit an empty box. The plan canvas now
starts 0 × 0, and the render gives it its size. "The canvas has a width" now means the sheet
is on screen, for every one of those specs at once, and a person sees no difference. Checked by
`scale-waits-for-sheet.spec.ts`: with the sheet's PDF held back 4 s, the canvas reads 0 until
it is drawn, and the same wait-then-click sets the scale. With the default canvas it reads 300
and the spec fails.

My earlier claim that takeoff-estimate-chain "fails 2 of 3 alone on main" was a bad measurement:
those runs used `--repeat-each`, and that spec is not repeatable in one database, so the failures
were its starter-library step, not these clicks.
