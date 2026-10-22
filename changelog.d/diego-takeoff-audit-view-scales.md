### Six real views had their scale printed beside them and missed by 0.0002

`sheetViews` found six views on a real Camp Bow Wow detail sheet and gave not
one of them a scale, while a scale was plainly printed on the page. Measured
rather than guessed: on every real view of two sheets, the caption sits at
`dx = +0.0202, dy = +0.0060` page-widths from its name. `NAME_ABOVE` of 0.02
covers the dy; `NAME_BESIDE` of 0.02 missed the dx by two ten-thousandths, on
all of them.

It is a layout, not a tolerance — a drafter writes the scale on the next line,
indented past the bubble number:

```
1   PLAN DETAIL AT PEMB FRAME
    SCALE: 1" = 1'-0"
```

52.4pt of indent on a 2592pt sheet, against a window of 52.0. `NAME_BESIDE` is
0.04 now: the indent a caption block can plausibly carry, not the 0.0203 that
would fit one template and break on the next. Those views sit about 0.19 apart,
so a caption still cannot be stolen by the view beside it — asserted, with the
neighbour case. Mutation-tested: at 0.02, four of the six new tests go red.

**And the ordering it was blocking.** The scale read ran first and the view
split only ran if it succeeded — backwards for exactly the sheet the split
exists for, since a sheet carrying several drawings at several scales is a
sheet whose printed dimensions disagree with each other, so it declined, so it
was never split. The split runs first now and each captioned view can be
measured at its own ratio, absolutely, because a caption is feet per paper inch
and needs no anchor. It stays the weaker evidence and stays second: a dimension
can be checked against the drawing and a caption cannot.

On the real-plan measure this took floor plans producing a number from **2 of 9
to 7 of 9** — though four of those five were the eval catching up to a
printed-scale fallback the app already had, and only the sixth and seventh are
new capability. The twenty fixtures and the bench are unchanged.
