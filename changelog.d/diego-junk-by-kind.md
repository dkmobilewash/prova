### What actually changed, in plain English (Diego)
`diego/junk-by-kind`

**A line ruled under a word is set aside as the word's underline.** A view
title, a notes-box heading or a legend caption gets a rule drawn under it as
long as the text, and paired with a box edge it read as a wall: 354 ft of
confirmed junk on the training sheets, 228 of them one notes box on Joplin.
`isUnderline` in `textRows.ts` names it — a horizontal run that covers a
word's extent, at the word's own height, no longer than 1.6 times the word
plus a foot — and `offeredCandidates` sets it aside as `underlines`,
reported like the table-rows rule. Swept on 36 labelled sheets against
main: 539 ft of junk removed for 19 ft of real wall (three room names on
short walls), no building worse by more than 10 ft.

**The stroke reader now keeps the pen's colour.** `StrokeSegment.gray` is
the stroke's luminance, carried through save/restore and the unit change.
Nothing reads it yet in the product; the junk census does, and it says grey
is not "existing": grey faces carry 11,457 ft of real wall against 4,271 of
junk, so colour is a classifier feature rather than a rule.

**The junk census now names what the lines are** — dimension lines, second
faces of real walls, one dashed face, furniture, kennels, grid and border,
casework, underlines, door swings, tag boxes — with the feet per kind and
the rules priced against each, in `NOTES.md`.
