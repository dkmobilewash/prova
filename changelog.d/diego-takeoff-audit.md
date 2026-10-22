### A sheet is more than one drawing, and a one-room building is a building (Diego)
`diego/takeoff-audit`

Five defects in the wall finder, each found by looking at an overlay rather
than at a number, and one capability that follows from the last of them.

**A one-room building returned nothing.** `wallsInTheBuilding` discarded any
group under `NOT_A_BOX` — ten runs — because the biggest group on a sheet with
no plan on it is the TITLE BLOCK, four runs, and it was being offered to an
estimator as the walls of a building. That count cannot tell a title block from
a building with one room, and both are four runs. S01, S06, S10, S11 and S15
reported ZERO FEET. The filters now run before the grouping — lettering, sheet
border and scale bar come out first and the building is looked for in what is
left, with no minimum size. Asking what the geometry IS costs no buildings.

**The column grid was being billed as wall.** `gridBubbles.ts` was written for
this against a 60-page key, measured 1,849 ft in a band matching no assembly on
the drawing, and was then never called by anything. It is wired in now, before
the pairer, because a grid line that has already paired with a real wall face
has corrupted that wall's thickness and no later filter can tell which face was
wrong. Only the lines with an END inside a bubble: `gridLineSegments` extends to
every COLLINEAR segment, and architects draw grids on wall centrelines, so that
version took missed walls from 115 to 263 and one whole wall type to -100%.
Removing the grid also removed the living-room SOFA on S08, which had been
pairing with a grid line passing it.

**A line passing a wall was pairing with it.** A 115 ft grid line CONTAINS a 40
ft wall face, so the overlap rule scores 100% — its best possible result — and
the length ratio is 2.87, inside the limit of 5. Every rule passed and the grid
still won. Two faces of one wall END TOGETHER; a line that merely passes
overhangs at both ends, by 56% and 132% of the face against under 2% for a
corner. `wallVectors.test.ts` already had a test for this defect, and it is what
caught the first attempt at the thickness cap below.

**The thickness cap stays at 12 inches and the reason is written down.** It
looked free to raise — five bench runs said 13in is identical to 12in and buys
26 ft of real exterior wall on S06, whose envelope reads 12.1in. A unit guard
said no: that test calls the PAIRER directly, `gridBubbles` runs one level up in
`findWallsOnSheet`, and the bench only ever exercises the pipeline. So the
filter protects the pipeline, the cap protects the pairer, and five green runs
were about a question nobody asked. The 26 ft is recorded as a known false
negative rather than taken.

**A sheet can carry more than one drawing, at more than one scale.** Every
length used to come from ONE of them. S15 read correctly and by luck — the
enlarged bath was dropped for being the SMALLER group, not for being drawn at
another scale, which inverts the moment the detail is the bigger drawing.
`sheetViews.ts` finds each drawing by its caption NAME, reads the scale on the
line below, and cuts the page on its GUTTERS — empty paper no geometry crosses,
in paper inches, on BOTH axes, so stacked and side-by-side separate by one rule.
A room cannot make a gutter: the walls above and below it hold the same column.

Three things that version got wrong first, each caught by a second sheet:

  - banding from each caption's x assumes the caption sits at the drawing's
    left margin, which the fixtures do and the bench's A-401 does not — its
    captions sit INSIDE their own drawings, so both lost their left edge;
  - a gutter is not only found between drawings. A plan's DIMENSION COLUMN sits
    to its left with empty paper between, and S05 and S07 went to ZERO FEET
    because the caption chose that strip. Regions pick captions now, not the
    reverse, so a strip with no caption of its own rejoins its plan;
  - `HEAD OF WALL DETAIL` is captioned `SCALE: NTS`. Read as "no caption here"
    its region was absorbed by the drawing beside it — and a wall detail is a
    cross-section, parallel lines a wall-thickness apart for its whole height.
    A view with a scale nobody can read still owns its region and is never
    measured, which is the only honest answer for NTS.

The quantities offered are the view holding the most wall, at the calibration
the app already trusts; the others are measured at their captioned RATIO to it
and REPORTED, not added — an enlarged view is the same construction drawn
larger, and summing them bids that bathroom twice. Captions are used as a ratio
rather than an absolute because S11's caption says 1/8in while its own
dimensions say 1/4in, and believing the caption costs 13 ft.

**What this does NOT fix, stated because the numbers invite the opposite
reading.** A-401 reports 679 ft where the key says 266. That is the wall
finder's accuracy on a detail sheet and it is PRE-EXISTING: the single-scale
baseline reports 678 for the same geometry. `benchMultiView.eval.ts` prints both
side by side so nobody reads the split as an accuracy win.

The checks: `sheetViews.eval.ts` splits all 20 fixtures and asserts at least one
reads as multi-view, because every sheet reading single-view is what a broken
caption reader looks like and it would print a tidy table and pass.
`benchMultiView.eval.ts` runs the only multi-view sheet in this repo that has
per-wall ground truth. 8 mutations on the splitter, 7 on the view model, 5 on
the caution, 3 on the viewer's wiring — all red, including "make it render
nothing" and "views are summed". Two came back GREEN first and the tests that
were not asking those questions were fixed rather than the mutations dropped.
