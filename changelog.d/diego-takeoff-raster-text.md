### A scanned sheet gives up its words

The companion to recovering a scan's lines. A scan is a picture, so the printed
scale, the room names and every dimension string are invisible to this app —
which is why a scanned sheet is recognised and set aside rather than taken off.

Deciding that a smudge of ink says `1/4" = 1'-0"` is interpretation, which is
the one thing ARCHITECTURE.md hands to a model. **The division does not bend
here**: the model returns WORDS and where they sit, and every length, area and
quantity is still measured from geometry. A dimension's value is read by the
model; the line it belongs to is measured by code; the scale is their quotient.
No number a customer is billed from comes out of a model.

**The bar was never "can it read the words".** `scaleFromDimensions` pairs a
label with a line only within 30 points, which is about one percent of an ARCH D
width — so a box off by 40 points is a label that pairs with nothing, and
perfect words do not save it. Measured against the vector drawings the scans
are rasters of, which is the same free answer key the lines half used:

| | |
| --- | --- |
| printed strings read exactly | **101 of 101** |
| placed within the 30pt the pairing allows | **98%** |

**Tiled, and that is the design rather than an optimisation.** A 36-inch sheet
sent whole is a thumbnail by the time the model sees it — nobody reads a
dimension string at 44 dpi. A tile is rendered at about 190 dpi, and the model
only has to place text within a window whose own offset on the page is exact.

**End to end, with nothing borrowed**, both scans read their OWN scale correctly
— `1/4"` and `1/8"`, matching the vector originals — and one produced **505 ft
against the drawing's 555, 91%**. The other returns nothing, and the stage
counts say why: 13 candidates found and `wallsInTheBuilding` discarded all 13.
That is the small-plan floor already documented in `NOTES.md`, reached from a
new direction rather than anything about scans.

**The first measurement said 79% and the ruler was wrong.** It compared the
model's box CENTRE against pdfjs's BASELINE-LEFT, charging it half a string's
width before the model had made any error. Centre to centre it is 98%. A
measurement that flatters nothing is still wrong if the two sides mean
different points.

**Guarded like the one feature it most resembles.** This is the SECOND feature
that sends an image of a customer's drawing, so it gets its own switch, its own
usage row — billed per TILE, since one sheet is nine requests — and its own
control on the takeoff toolbar, shown only when Find the walls returns no
lines. Two places in the repo asserted the wall classifier was the ONLY feature
that sends an image; both are corrected rather than left to rot.

**7 of 7 mutations red on the action's guards**, including the switch being
checked after the image is sent, and 8 of 8 on the coordinate arithmetic — one
of which, dropping the tile's vertical offset, survived the first run because
every case placed its text in the top row.

**Not built, and visible on screen rather than hidden**: the words are used by
Find the walls on its next pass, but a scan's LINES are not yet fed from the
raster path in the viewer, so a scanned sheet reads its scale today and still
needs its walls traced. That is the next piece, not a claim this one makes.
