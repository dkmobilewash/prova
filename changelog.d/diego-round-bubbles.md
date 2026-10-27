### A grid bubble has to be drawn round (Diego)
`diego/round-bubbles`

The grid-bubble stage finds the column-grid circles and deletes every line
that ends inside one, so the grid cannot be paired as walls. Its roundness
test checked only that a loop's corners were one distance from its centre,
which every rectangle, hexagon and regular polygon satisfies. On Topeka's
first-floor plan it took 316 straight-sided loops for 2 real circles —
hexagonal window tags and the window symbols drawn inside the wall — and
deleted 46% of the sheet's strokes, the wall faces under those tags among
them. That was 60% of everything the finder missed on the training sheets.

Now a bubble must be drawn with arcs (every piece flattened from a curve),
its vertices and edge midpoints within 13% of one radius, its area-to-
perimeter ratio within 10% of a circle's, and the chain closed. Measured on
26 training sheets against the shipped test re-run as a control: 2,528 ft of
real wall recovered (Topeka p74 +937, Crosslines +598, Joplin +401, MHK
+254), 14,316 ft of extra proposals added, nearly all of it on unit-plan
sheets (ELEVEN03, Topeka p75/p76, Camp Bow Wow) where the old test had been
deleting casework and fixtures by accident. The per-sheet table and the
reason the junk is a separate job are in `lib/takeoff/NOTES.md`.

Check: `gridBubbles.test.ts` refuses the same 12-piece circle when its
pieces are straight, a hexagon, an octagon, a curved ellipse and an unclosed
curved chain, and still finds a flattened circle at any sheet scale.

**And a caption is whatever the drafter wrote over the scale.** Baker A401
captions twelve interior elevations and an enlarged plan by room and
direction — "RESTROOM 1 NORTH", "HALLWAY EAST" — with a scale under each,
and the view finder required a drawing word, so it saw none of them, the
sheet's notes headings took the drawing region, and the viewer found zero
walls for the wrong reason. Now the lettering over a readable scale is a
view whatever it says, with the title block's own scale kept out as
before; A401 reports thirteen drawings, none measurable, each marked
"check it". The 26 training sheets are unchanged by it. The server-side
calibration detect measures the same sheet whole at 796 ft and is
recorded in `NOTES.md` as the open half.
