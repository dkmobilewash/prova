### A demolition plan on the same sheet of paper is aligned by its frame

Some sets print the demolition plan on the same paper, in the same frame, with
the building in the same place (Green Bay A3.1/A3.2, McAllen A3.2). The finder
pairs too few of the demolition plan's walls for the wall vote to line the two
up, so nothing was compared and every existing wall was offered as new work.

`samePaper()` (priorPlan.ts) now checks the frame: same page width, and every
long border rule on one page has its twin on the other (at least two, so a blank
page cannot pass). When the wall vote fails but the frame matches, the frame is
the alignment. What it compares against is narrower than a wall-aligned pair:
only solid demolition lines at least 6 ft long (a dash is a wall to be removed),
never one on a removed wall, and a run is set aside only when both its faces are
drawn along 80% of it (`FRAME_SHARE`, via `PriorLine.minShare` in planCompare.ts).

Measured on training (labels-snap-20261110T0122, suggestions accepted): 1,397 ft
of junk set aside, 0 ft of real walls; renovation posted vs key +101.3% → +74.8%;
new build unchanged at +18.3%; no other sheet moved. Held-out, measured once:
one sheet changes (+271% -> +198%), 118 ft of junk and 15.9 ft of real wall set
aside (0.26% of the held-out renovation key; 7:1). That passes the renovation
bar Diego set 2026-11-10, the same on held-out as on training: real lost at
most 1% of the key, at least 3:1, each loss explained. The 15.9 ft is one new
wall drawn exactly where the demolition plan draws a solid line on both faces.

Tests: priorPlan.test.ts, the frame check and what a frame-aligned pair sets
aside. Mutations each red a test: the frame branch removed, the two-rule floor
removed, `FRAME_SHARE` loosened to 0.3, `minShare` dropped.
