### A section bubble with no closed shape is still a callout, not a wall tag (Diego)
`diego/callout-tags`

Round 12b took the training floor plans keyed with wall types from 3 to 7.
The hatch fix (#983) holds on all 7. Only Joplin moves: 79% → 85% of
typed footage correct.

The remaining wrong types on the 7 sheets, by cause (380 ft):

| Cause | Wrong ft |
| --- | --- |
| another type's tag read on the wall | 144 (Grand Junction 91) |
| a variant's tag (A3) on a plain-family wall (A), Joplin | 101 |
| the note's default (A) where the key says A3, Joplin | 98 |
| carried along the wall too far | 33 |
| masonry note (B) on a non-masonry wall | 4 |

Grand Junction's 91 ft is one brick wall typed A3. The "A3" is a section
bubble, "A3" over sheet "A112". A text tag with a sheet number printed within
a third of an inch was already dropped as a callout. A legend code read as
bare text was not. Grand Junction's bubble has a pointer, so it never closes
as a symbol. Its code came through the bare-text pass, which skips only
text inside a symbol. Bare tags now get the same sheet-number check.

On the 7 keyed sheets, wrong footage falls 380 → 289 ft and correct-of-typed
rises 85.0 → 88.1%. Typed-correct footage is unchanged at 2,147 ft. Across
all 42 training sheets only two change, 235 ft in all, and every dropped tag
is a callout:
- Grand Junction: 163 ft goes untyped, from "A3/A112" and "A1/A115".
- Joplin: 72 ft goes from A3 to the note's A, from "A3/A-411".

Not fixed:
- Joplin's A3/A (199 ft). Most A3 leaders end 0–0.2 ft from walls the key
  calls A, and two end where two walls cross. One leader end comes from the
  wrong stroke (45 ft). There is no single cause to fix.
- Bunkie's W2 marks are window tags. They never name a run today: W is not
  a wall-tag prefix and not in Bunkie's legend. A test now pins that.
