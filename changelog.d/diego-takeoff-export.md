### A takeoff summary an estimator can send or keep — CSV and PDF, quantities only, behind a switch that is OFF

Two buttons on the takeoff tab, shown only once the account owner turns
**Export a takeoff summary** on under Settings: a CSV and a PDF of what the
estimator put on the takeoff. No prices anywhere in either file.

**What the estimator ACCEPTED, not what the finder saw.** "Add as S8B —
priced" writes a group's runs as LINEAR measurements with a wall run naming
the type and height; those add up **by wall type** with feet, height, board
square feet, studs and track. A LINEAR measurement with no wall run ("Add
these", or a hand-traced line) is an **untyped wall**: one block, by label,
feet only — no studs, track or board, because a quantity needs a type and
guessing one is what this file refuses. Rooms are the areas the room finder
saved, by name and number, named first and unnamed marked and last. Other
areas add up by item (a ceiling is whatever item it was traced under). Doors
are the newest unrejected DOOR schedule read per sheet. The finder's raw
groups (`TakeoffWallProposal`) are not in the file at all.

**Floor plans only.** A sheet the index calls a schedule, section, elevation
or cover is left out even when something was measured on it, and the file
says so in a "Left out" row rather than dropping the work in silence.

`lib/takeoff/summaryExport.ts` is one pure function from what the takeoff
page already loads; a figure in the file is the figure on screen. The PDF
embeds one marked-up sheet per measured floor plan from the plan file with
`pdf-lib` (already a dependency) — vectors, no rasteriser — with typed runs
coloured by type, untyped in grey, rooms and areas filled, and a legend.
`placeEmbedded` honours a page's `/Rotate` and has its own test.

Measured on Baker (training) by standing in for the walkthrough on A101 —
library of eight types read off A601 and A301, Find the walls, Add on every
group, Find the rooms: 6 types typed from tags and thickness (351 ft), 8
untyped thicknesses (315 ft, feet only), 6 named rooms, one sheet page.

Schema: one additive boolean, `Company.takeoffExportOn`, default false.
