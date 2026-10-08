### Find the walls finds about twice as many of them now (Diego)
`diego/room-finder`

Pressing **Find the walls** used to run one method: look for two parallel
lines a wall's thickness apart. That is a real way to read a drawing and it
cannot be complete, because not every wall is drawn as two lines — and
measured across four real plan sets it was finding roughly 40% of them. An
estimator cannot bid from an unknown 40%: the walls it missed are invisible,
so the sheet has to be traced by hand anyway and the tool has saved nothing.

There is now a second method running beside it. A floor plan is a set of
enclosed spaces; rooms are the big ones, and **a wall is a thin space with a
different room on each side**. That is true however the wall is drawn, and it
has a completeness argument the first method does not: every wall bounds a
room, so finding the rooms cannot miss one.

The two fail in opposite ways, which is why both run. Pairing needs two
faces and does not care whether anything encloses, so it reads an open-plan
showroom and a demolition plan. Rooms need spaces that close and do not care
how the wall is drawn, so they read poché and single-sided walls. Measured
through the same filters on three real sheets, neither wins alone and the
union beats both on every one:

| sheet | before | after |
| --- | --- | --- |
| Augusta (court offices) | 608 ft | **707 ft** |
| Naples (airport offices) | 657 ft | **1,302 ft** |
| West Herr (dealership) | 1,495 ft | **1,679 ft** |

Three things had to be solved to get there, and each is a check rather than a
claim.

**The same wall now arrives twice, and feet become a bid.** Raw concatenation
of the two gave 1,080, 2,108 and 2,594 ft — arithmetic, not walls. Two
findings are merged when they lie on the same line, point the same way and
cover the same stretch of it; the merge removes about 35%. It also joins the
fragments a single method makes of one long wall at its junctions, so a
partition comes back as one run of the right length rather than four.

**Doorways were merging every room into one.** A gap in a wall joins the
rooms either side, so the wall between them stops separating two *different*
rooms and is discarded. On West Herr that was 32,256 of the sheet's 49,162
sq ft of room as a SINGLE space, with 1,062 wall-width regions found and
almost all thrown away. Door-sized gaps in a wall face are now closed before
the rooms are read, which nearly tripled that sheet. On a plan whose rooms
already close it does harm instead — Augusta lost 149 ft to it — so both are
run and the better is kept, which takes half a second and cannot regress.

**A wall has to become a measurement.** A region is a blob of cells and a
cavity where four walls meet is one blob holding four runs, so the shapes are
thinned to a centreline, cut at every junction, and straightened back to the
two points a wall actually has. Measured on real sheets: 2.4 to 2.7 points
per run.

Nothing else changed. The groups, the accept panel, the ghost lines over the
sheet, and the three filters that reject the title block, the lettering and
the sheet border are all untouched — the new method returns the same shape
the old one did, deliberately, so that none of them had to be rewritten.

**What this is not.** Every figure above is footage FOUND, not footage
correct. There is no hand-traced sheet to measure against yet, so "more" is
not yet known to be "more right". That reference is the next thing worth
having, and it would turn every number here from a comparison into an
accuracy.
