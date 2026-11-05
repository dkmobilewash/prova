### Baker A101 counts 18 doors again: #989's box-outline rule is for wide boxes, and a room box reads its name (Diego)
`diego/outline-wide-only`

Bisected by the third session: click-list D1 (Baker A101, 18 doors) read 20
after #989. Its rule measured a symbol's lettering by the symbol's own outline
whenever the shape was long, to stop McAllen's stacked IW boxes reading each
other. Two side effects on Baker:
- the room-number boxes read "112" and "100" instead of "SUPERVISOR 112" and
  "VESTIBULE 100", so they passed as door marks and kept two untagged existing
  swings;
- the UPRIGHT hexagon door tags, whose lettering is rotated and computed off
  to one side, read nothing.

Now the outline rule is for boxes at least 2.5 times as WIDE as they are tall;
anything else keeps the ring. A wide box reads its own lettering, plus
lettering over or under it within its width and clear of it, and never
lettering inside a neighbour's outline (a mask drawn round the tag holds the
tag's centre, so it does not count as a neighbour).

- D1 probe (third session's, Baker A101): **18 doors, 2 pairs** (was 20).
- Wall types on the 7 type-keyed training sheets: 2,553 ft right / 355 wrong,
  **identical to main run for run** (McAllen still 248 / 9). A first version
  without the "clear of it" condition lost one 10 ft run on Green Bay to a
  rotated dimension beside an IW-4 box; that case is now a test.
