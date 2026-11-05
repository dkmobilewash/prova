### The answer key holds windows: one click each, with the tag the drawing shows (Diego)
`diego/window-answer-key`

For round 13, so a reviewer can key windows on a sheet. In the labelling
panel, "Mark windows" arms the sheet: a click marks a window and a click on a
mark removes it. The newest mark takes its tag from the keys: 1–9 for the
window tags read on the sheet (`windowTagsOnSheet`, the same symbol reading
`doorsAndWindowsForSheet` uses), 0 for "no tag shown" (`-`), or a typed tag.
A running count is shown. Arming marking disarms tracing, and the other way
round.

The marks follow #964's wall-type pattern through every file:
- `ReviewState.openings`, with `addOpening`, `removeOpening` and `setOpeningTag`;
- the labels route and `LabelFile.openings`, tags upper-cased;
- `restoreSaved`, including a file that holds only windows;
- drafts and the draft signature;
- `keepReview`, so a re-read of the walls never drops a mark;
- `keyFromLabels`.

`scoreOpenings` matches found to marked within 2 ft, nearest first and one to
one, and reports found, missed and false, plus tag-correct over the marks
that carry a real tag. No schema change.

Tests: `windowKey.test.ts` and `answerKeyPanel.test.tsx`. The click on the
sheet is the viewer's and has no unit test, because happy-dom does no layout.
The PR's click-list covers it.
