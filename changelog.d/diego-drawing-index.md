### The set's own index, against what actually arrived (Diego)

`diego/drawing-index`

Every commercial set prints its own index: a table of sheet numbers and titles.
`sheetIndex.ts` has always known what pages are HERE and spotted a number used
twice. **Nothing has ever checked the other direction** — that the set lists a
sheet nobody uploaded a page for. A set missing four drawings has looked exactly
like a complete one.

That is the expensive direction. A bid priced off an incomplete set is not a bid
that comes in low; it is one that wins and then meets a drawing nobody read.

**Check against the set's own index** on the sheet review reads it and names
what is missing.

#### Measured on six real sets before any of it was written

Three discriminators, in the order they were tried:

| set | pages | number-shaped | + a title beside it | IN TALL COLUMNS |
| --- | --- | --- | --- | --- |
| Naples | 52 | 52 | 52 | **52** |
| Augusta | 55 | 56 | 56 | **55** |
| Pittsburgh Zoo | 27 | 27 | 27 | **27** |
| SRFR | 93 | 101 | 101 | **93** |
| Alden Green | 38 | 36 | 36 | 32 |
| West Herr | 52 | 0 | 0 | **0 — no text layer** |

The shape alone over-counts: a legend of drawing symbols (`F1`, `W1`, `GL-1`,
`EQP-1`, `FIN-1`) reads exactly like a sheet number. **Requiring a title beside
it — the obvious fix — changed nothing at all**, because a legend is a table
too. That is recorded in the code and in a test, because it is the
discriminator the next person will reach for.

What works: **an index is a COLUMN.** Its numbers share an x-position down the
page; a legend's handful sits elsewhere. Clustering by x and keeping the biggest
column got SRFR and Augusta exactly right and broke Naples 52 → 18, because a
wide index is several columns side by side. Keeping every column *comparable in
size to the tallest* fixes that and still drops the legend.

And the index is **not always on page one** — Augusta's and SRFR's are on page
2, so scanning only the cover found nothing on either.

#### The case that matters most is the one that finds nothing

West Herr's cover is a raster scan with no text layer. `readDrawingIndex`
returns **`null`**, and `missing` stays `null` all the way to the screen, which
says *"Couldn't read this set's own drawing index… check it by eye."*

"We could not check" and "nothing is missing" are different sentences, and
reporting the second when the first is true is the vacuous green this repo keeps
paying for. `compareIndex` will not accept a null index, and the type will not
let a caller read `missing` as an empty list.

#### Two defects found by mutation, both green against every screen test

- **Comparing against the machine's guess instead of a person's correction.** A
  title block misread as `A1O2` and fixed by hand to `A102` would have been
  reported back to them as a missing sheet.
- **An unreadable index returning `missing: []`.** The all-clear above, arriving
  by accident.

Both lived in the Server Action, which had no test. The decision now lives in
`indexCheck()` — pure, no PDF, no database — and both mutations red.

#### What is not covered, stated rather than discovered later

A legend beside a **short** index is indistinguishable: a 4-row legend next to an
8-sheet index comes back as 12, and there is a test saying so. The alternative is
a higher floor, which throws away the second and third columns of a genuine
multi-column index — Naples reporting 18 of 52. A set small enough to hit this is
one somebody can check by eye in a minute.

Alden Green reads 32 of 38. Not diagnosed; it is under-reporting, which produces
false "missing" entries rather than a false all-clear.

#### Checks

- `drawingIndex.test.ts` — 21 cases. **Nine mutations, all red**: page 1 only,
  every page, no clustering, tallest column only, null becoming an empty index,
  punctuation no longer normalised, blank sheet numbers counted, the
  couldn't-read sentence reading as an all-clear, missing sheets counted but not
  named.
- `planIndexCheck.test.tsx` — a RENDER test per #665, plus a census of the one
  call site, because the button only appears when `planId` is passed and
  forgetting it is a one-character mistake that hides the feature and breaks
  nothing. **Seven mutations, all red**, including that one.
- **No customer drawing is a fixture.** Plan sets are confidential; every page
  here is built by the test to the shapes measured above.
- `surface-card` drops 16 → 15: the duplicate-sheet warning beside this was
  retokened to a colour the config actually defines. The census caught both
  directions — adding three sites, then removing one too many.
