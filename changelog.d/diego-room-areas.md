### Area takeoff: the rooms inside a box the estimator drags (Diego)

`diego/room-areas`

Area is the last big quantity still traced entirely by hand — ceilings, flooring
and paint all need it, and on a 20,000 sf plan it is a hundred-odd polygons drawn
one corner at a time. Press **Find the rooms**, drag a box round the plan, and
the rooms inside it come back as AREA measurements.

The engine already existed. `rooms.ts` finds enclosed regions and the wall finder
already uses them; `skeleton.ts` already had the Ramer-Douglas-Peucker needed to
straighten an outline. What was missing was knowing which part of the sheet is
the plan.

#### Why there is a box, measured rather than assumed

Run over a whole sheet the region finder returns every enclosed shape on the
page, and the non-plan ones are **not distinguishable by geometry**. At
1/8in=1ft a hairline between two table cells is about half an inch thick in
building units and several feet long — the same shape as a wall. On Naples p9
the entire right-hand notes column came back as rooms; on Augusta p11 the sheet
margin came back as one **24,789 sf** room.

Three automatic discriminators were built and measured. **All three failed:**

| rule | why it failed |
| --- | --- |
| bounding-box span and fill | catches the margin (span 82%, fill 37%) and misses Naples' drawing backgrounds, which fill 75% of their box exactly as a room does |
| only regions a DETECTED WALL bounds | notes panels pass — their cell lines are wall-shaped by every measure that matters |
| the largest cluster of rooms sharing walls | the best of the three, and still wrong: the margin joins the building's cluster THROUGH THE EXTERIOR WALL, which is a real wall separating two real spaces |

So the box is a fix rather than a workaround. Cropping does not hide the margin,
it **removes the category**: the grid is built over the box alone, so the paper
around the building now reaches the edge of the grid and `regionsOf` marks it
`open` — which was always excluded, and which `rooms.ts` already describes as
"the paper AROUND the drawing rather than a space inside it". No threshold, no
new rule, no tunable.

Inside a box the rooms are right. Augusta p11: **90 rooms, 15,596 sf, 868ms**,
each office its own region, the corridor correctly one run, boundaries on the
walls, the hatched existing building correctly yielding nothing.

#### Two bugs no test could have found, both caught by drawing the output

The polygons are drawn on the sheet, which is the verification channel and the
whole safety argument — a wrong room is a shape sitting where no room is. It is
also how both of these surfaced, neither of which any assertion here could see:

- **Rings with long diagonal chords straight across rooms.** Where a region
  pinches at a corner, four boundary edges meet, and the tracer took whichever
  had been registered first — so the chain jumped between two parts of the
  boundary. A chord still has an area and still has corners. It is not
  cosmetic: `saveTakeoffMeasurement` REFUSES a self-intersecting AREA ring, so
  those rooms could never have been accepted at all. Fixed by always taking the
  sharpest right turn, which is the standard face-tracing rule.
- **406, 376 and 869 corners on the first rooms Augusta returned.** A real wall
  is never exactly axis-aligned once rasterised, so its contour zigzags by a
  cell and almost nothing is collinear. `skeleton.ts`'s `straighten` at two
  cells of tolerance takes those to 80, 81, 43.

#### The bound it ships with, stated rather than hidden

The traced outline is the room's OUTER boundary, so anything standing inside it
— a column, a stair core, a shaft — is inside the number. `columnsIncluded`
measures that, the panel says *"includes something standing in it"* on each one
affected (12 of 90 on Augusta), and those rooms draw in amber rather than green.
It is right for some trades and wrong for others, and only the estimator knows
which. Outlines also weave around furniture drawn against a wall, which
under-measures slightly; free-standing furniture is a hole in the region and is
correctly included.

The area shown is always the POLYGON's, never the raster cell count, so the
screen cannot promise one figure while the estimate line carries another.

#### Nothing is applied automatically

Same posture as the scale and wall work: the app proposes, the person accepts.
Nothing is stored until **Add these N rooms** is pressed, individual rooms can be
dropped with *Not a room*, and manual tracing is untouched. Detection runs in the
browser on strokes already in hand — no round trip, no new table, no AI, no spend.

#### Checks

- `roomAreas.test.ts` — 13 cases. **Six mutations, all red**: the box ignored,
  the ring replaced by a bounding box, the pinch taking the first edge, the
  straightening removed, the `open` region admitted, collinear points kept.
  Three of those mutations were GREEN first and each named a real blind spot —
  an L-shaped room was never detected end to end, every fixture was exactly
  axis-aligned so the straightener had nothing to do, and a two-cell pinch
  happens to register the correct edge first (a checkerboard does not).
- `takeoffRoomFinder.test.tsx` — a RENDER test, not a census, per #665. Nine
  cases. One mutation was green first: adding `hidden` to the button left every
  assertion passing, which is #665 exactly, inside the test written to prevent
  #665. It now asserts the button is not hidden.
- `takeoff-found-walls.dbtest.ts` — five AREA cases. Two mutations were green
  first: the action hardcoded `kind: "LINEAR"` and accepted self-intersecting
  rings, and nothing could tell.
- **No customer drawing is a fixture.** Every test shape is drawn by the test;
  the real-sheet numbers above were measured by hand and are recorded here.
