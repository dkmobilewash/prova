### The room finder gets the lettering filter the wall finder has had all along (Diego)

`diego/room-stroke-filter`

First half of the fix behind #712, which took **Find the rooms** off the toolbar
after it reported 4,555 sf on a 290-ft building.

**The button stays off.** This is one filter, measured, not a feature coming
back.

#### The instrument had to be built first, and it was wrong twice

A detector is judged by what it MISSES. #702 was judged by a picture of what it
found, which looked convincing while a whole wing was absent from it. Ground
truth is free and already printed on the sheet: a **room tag** in the middle of
every room.

That instrument gave two wrong numbers before it gave a right one:

- **0 rooms on every sheet.** Not 0% recall — a broken probe. It passed
  feet-per-POINT where the viewer passes feet-per-page-WIDTH, so the grid
  thought the sheet was a tenth of a foot across.
- **West Herr 70/70, 100%.** Also false. Every tag sat inside one giant merged
  region, so **a detector returning one page-sized blob scores 100%**. A tag
  now only counts when the room holding it contains at most two tags and is
  under a quarter of the box.
- **7% overall**, measured over the WHOLE SHEET — a configuration the feature
  does not have. It requires a box, and without one the sheet margin is an
  enclosed region spanning 83% of the page; it only becomes `open`, and
  therefore excluded, once the grid is cropped. The box now comes from the
  tags' own extent, which is independent of the detector.

#### And the denominator was most of the error

The first population was any alphabetic string, which admitted `FEC`, `MATCH
LINE`, `FULL HEIGHT WALL`, `NOT TO DECK.` and `FROSTED GLASS DOORS`. On
Pittsburgh Zoo p6 it was almost entirely note text, so its 9% measured the
detector against a question nobody asked.

**A room tag is a name with a ROOM NUMBER beside it** — `CONFERENCE` over
`1102`, `JUDGE BIAS` over `1104`. That is how a plan labels a room and how it
labels nothing else.

| sheet | denominator | every stroke | lettering dropped |
| --- | --- | --- | --- |
| **Augusta p11** | 33 real room names | 64% | **79%** |
| West Herr p21 | half equipment labels | 49% | 49% |
| Naples p9 | **0** — no name/number pairs | — | — |
| Pittsburgh Zoo p6 | its own legend | — | — |

Against the dirty denominator this filter looked worth five points and I called
it "not a fix". Against a clean one it is worth **fifteen** on the only sheet
whose ground truth can be trusted.

#### What the filter does

A sheet whose glyphs are saved as line work carries an enormous number of tiny
strokes — West Herr p21 has **197,620**, against 23,351 on Augusta. Every
outline is ink, and ink carves regions, so a room with a note in it comes back
as slivers around the letters.

`wallVectors.ts` has had `wallsNotLettering` for this since somebody looked at
real wall output. This is the same rule on raw strokes, with the same unit
scar written into it: the pad is in FEET, converted — a bare number is two
points to the server reader and two PAGE WIDTHS to the viewer, which would put
the whole drawing inside a text box.

#### What this is not

**79% on one sheet is not a number anybody should bid from.** Three of the four
sheets still cannot be measured honestly, West Herr did not move at all, and
`takeoffRoomFinder.test.tsx` still asserts there is no button.

#### Checks

- Six cases for the filter. **Six mutations, all red** — after two came back
  green and both were my tests passing for the wrong reason: the "wall behind a
  tag" never had its midpoint inside the box, and the "half out of a box" case
  was inside the padded box at both the endpoint and the midpoint, so it could
  not tell the two rules apart. Both now discriminate.
