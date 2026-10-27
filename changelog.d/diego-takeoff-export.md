### A takeoff summary an estimator can send or keep — CSV and PDF, quantities only, behind a switch that is OFF

Two buttons on the takeoff tab, shown only once the account owner turns
**Export a takeoff summary** on under Settings: a CSV and a PDF of what was
measured on the drawing set. Walls by type with feet, height, board square
feet, studs and track; rooms with square feet and perimeter; other areas by
item (a ceiling is whatever item the estimator traced it under — nothing on a
measurement says "ceiling"); doors from the schedule the model read. Every
line names the sheet(s) it came from. No prices anywhere in either file.

**Nothing new is measured.** `lib/takeoff/summaryExport.ts` is one pure
function from what the takeoff page already loads: the stored wall groups
named by the same `verdictFor` the viewer prices by, `TakeoffMeasurement`
rows at their own calibration the way `itemQuantity` reads them, the newest
DOOR schedule read per sheet. A figure in the file is the figure on screen.
Board square feet is feet × height × sides with no opening deduction, because
a stored run carries opening widths and no heights; a wall with no type, or a
type with no default height, shows a blank rather than a guess.

**The PDF carries one marked-up sheet per measured page, as vectors.** The
sheet is embedded from the plan file with `pdf-lib` (already a dependency)
and the runs and polygons are drawn over it with a legend — no rasteriser,
which this server does not have. A page's own `/Rotate` is honoured by
`placeEmbedded`, which has its own test; Baker's thirty rotated pages are the
reason. A page that cannot be embedded (empty, or the file will not open)
gets its line on the page rather than failing the download.

Measured on Baker (training), scales from what each sheet prints: three
sheets, 76 CSV lines, a 2.3 MB PDF in 0.7 s. One thing the eval surfaced for
the finder lane rather than fixed here: A401 finds 13 groups on the server
(no candidate collector) and nothing in the viewer's path (collector set).

Schema: one additive boolean, `Company.takeoffExportOn`, default false.
