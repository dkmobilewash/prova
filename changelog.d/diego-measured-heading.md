### "Measured on sheet 21" read as a caption for the sheet you were looking at (Diego)

`diego/measured-heading`

A browser run reported it as a stale caption, seen while sheet 1 was open.

**It was not stale and nothing was wrong.** There really are measurements on
sheet 21, and each measured sheet gets its own section below the viewer. It read
as a caption because it sits directly under the drawing with nothing saying
these are ALL the measured sheets rather than the one on screen.

So the fix is a heading, not a change of behaviour: **"Measurements by sheet —
every sheet with measurements on it, not just the one open above."**

Worth recording that the report was right to be filed. A true heading that reads
as a false one costs the same trust as a wrong number, and this product has
spent that trust twice this week on the drawing-index check. The cheapest
outcome was two lines of prose; the alternative was somebody "fixing" the
section to follow the open sheet, which would have hidden every other sheet's
measurements.

#### The other half of that report, NOT fixed here

**"Drawing…" outliving the drawing is a real defect and is not the one it looked
like.** The first diagnosis — written before re-reading the report — was that
the badge gets stranded by the `if (!cancelled)` guard in the render effect's
`finally`. The report refutes it in its own words: the badge was *"still in the
page at 36 seconds and gone by about 45"*. **A stranded flag never clears.**

So the flag is working and the render genuinely takes ~45 seconds on that sheet.
The badge is honest; what it is honest about is a page that takes three quarters
of a minute to draw. Hiding or softening it would conceal that, which is why
nothing here touches it.

The one path that COULD strand the flag was checked rather than assumed: the
early `if (!doc || !canvas || pageCount === null) return` sits above
`setIsRendering(true)`, so a cancelled run followed by an early return would
leave it on with nothing to clear it. It needs the document or the canvas to be
null, which happens before load or after unmount, not between pages. Left alone,
recorded here so the next reader does not re-derive it.
