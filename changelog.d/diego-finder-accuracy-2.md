### Finder accuracy 2: a grid bubble has to be drawn round, and a caption is whatever is written over the scale (Diego)
`diego/finder-accuracy-2`

The grid-bubble stage finds the column-grid circles and deletes every line
that ends inside one. Its roundness test checked only that a loop's corners
were one distance from its centre, which every rectangle, hexagon and
regular polygon satisfies, so on a unit plan it took the hexagonal window
tags and the window symbols drawn inside the walls, and the wall faces
under them with it: on Topeka p74 316 straight-sided loops for 2 circles,
46% of the sheet's strokes. Now a bubble must be drawn with arcs, its
vertices and edge midpoints within 13% of one radius, its area-to-
perimeter ratio within 10% of a circle's, and the chain closed.

Chrome reviewed the candidates that uncovers, and most are walls: 134 of
180 on Topeka p74, 161 of 236 on p75, 177 of 244 on p76, 66, 126 and 118 of
117, 187 and 164 on ELEVEN03, 125 of 189 on Crosslines. Against the shipped
finder with the classifier on, leave-one-building-out over the 26 training
sheets: 12,017 ft of real wall recovered for 3,585 ft of extra, 3.4 ft per
ft. Camp Bow Wow A101 goes the other way — its kennel panels and fences are
drawn as walls and the old test had hidden them by accident — and three
buildings whose new candidates nobody has reviewed yet carry unlabelled
extra; `lib/takeoff/NOTES.md` has the per-sheet table and the reasons.

Also here: a view caption no longer needs a drawing word. Baker A401's
thirteen captions name rooms and directions over a scale each, and none
was a view, so the sheet's notes headings owned the drawing. The
measurements that led here — the classifier's veto against the uncovered
casework, the junk filter that was not the next thing, the split-face
pass that round-bubbles makes unnecessary — are recorded in NOTES rather
than shipped.

Checks: `gridBubbles.test.ts` refuses the same 12-piece circle drawn with
straight pieces, a hexagon, an octagon, a curved ellipse and an unclosed
curved chain; `sheetViews.test.ts` finds a room-and-direction caption
once, by its title and not the number beside it, and still leaves the
title block's scale out. No browser test.
