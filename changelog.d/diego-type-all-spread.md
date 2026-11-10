### "One type for all", explained, and the spread shown on the button

The no-AI renovation walk (2026-11-08) priced Green Bay as 1,955 LF of one wall
type, W1. Why:
- **Nothing was suggested.** A trade preset's types carry thicknesses (W1 is 3⅝"
  studs with ⅝" board each side, 4-7/8"). Green Bay's groups read 3-7/8", 13-1/2"
  and others. No preset type is that thick, so no group got a suggestion.
- **"A" typed every group at once.** The queue's "Pick a type for all N groups
  nothing names" puts the type picked on every unnamed group of the sheet, whatever
  its thickness. That was built for walk v6, where a sheet had 13 untyped groups, and
  it is kept. The walk script pressed A once, as a person can.

What changes: when those groups differ in thickness, the button says so, e.g.
"W1 on all 16 groups nothing names on p9, 3-7/8" to 13-1/2" (A)". Typing walls of
different thickness as one type is then a choice made seeing it. The behaviour is
unchanged. `accept-sheet.spec.ts` reads the new text on two groups at 6-1/8" and 8".
