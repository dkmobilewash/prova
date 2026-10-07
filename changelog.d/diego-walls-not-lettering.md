### It was reading the room numbers as walls (Diego)
`diego/walls-not-lettering`

Three defects, all found by a click-through on a real 29-sheet plan set within an
hour of #669 going live. Two of the three shipped the same day.

## One — lettering read as walls

Two entire groups on one sheet were text: **64 runs at 14-1/2" sitting on
dimension strings** (`4'-0"`, `10'-0"`, `12'-0"`) and **15 at 13-1/2" entirely on
room-number tags** (121, 133, an A106 marker) with not one wall among them.
**79 of 205 runs.**

When a drawing's lettering is saved as line work, the two sides of a `0` are
parallel, a few inches apart at drawing scale, and the right length. Nothing
about their SHAPE says they are letters, and the pen does not help — a title is
drawn heavy. This also explains the thick clusters flagged as suspicious back in
#666 and never run down.

The text layer says it, and this app already extracts every item's box for every
sheet. Measured before building: it removes 7, 14 and 67 runs on three real
sheets, with the partitions still fully traced in the picture afterwards.

**Bounded by LENGTH, because a plan puts its labels ON the thing they label.** A
partition running under a room number is ordinary, and dropping it would be worse
than keeping the tag: a missing wall is a short bid, while a wrong one is visible
on the drawing and gets rejected. Above four feet a run is kept wherever it sits.

## Two — the zoom-out button zoomed IN

A fitted 42-inch sheet in a narrow window sits at **11%**, below the 15% floor.
`stepZoom` returned `ZOOM_STEPS[0]` when nothing was smaller — so `−` took it to
**15%, which is bigger**, and then greyed the control out. Fit is a computed
scale and can legitimately sit below every step; there is simply nothing further
out, and it now says so by staying put.

## Three — "Fit" did not fit

In a wide, short window Fit chose 28%, matched the sheet's WIDTH exactly, and
left a 724px drawing in a 382px box with the top half cut off — labelled "Fit"
the whole time. #667 made that a deliberate choice with a stated reason: sheets
are landscape, so width binds, and fitting height too would shrink a 42×30 on a
laptop. **The reasoning was wrong.** A control called Fit has one job; whichever
dimension binds, binds.

## Verification

- 80 tests across the two files.
- **6 mutations, each red.** Four were GREEN first and three of those were my
  FIXTURES, not the code:
  - the long-wall-under-a-tag test put the label off to one side, so the wall
    was kept because it was never near the text — removing the length guard
    changed nothing;
  - the pad test used a midpoint outside both the right pad and the wrong one;
  - the viewer could stop calling the filter entirely (the wiring gap every one
    of these has had).
- A guard for an empty text layer was **deleted rather than tested**: `.some()`
  over nothing is already false, so removing it changed no behaviour — an
  unreachable branch, exactly like the single-weight guard in
  `heavierThanHatching`. The behaviour is still asserted; the branch is gone.
- `fitZoom` was extracted into `takeoff-plan-view.ts` because a mutation proved
  it untestable where it was — the same move as `errorBandText` and `stepZoom`.
  A decision written inside a component is a decision no test can reach.
- **The pad is in FEET, converted.** The first version wrote a bare `2`, which is
  2 points to the server reader and **two page widths** to the viewer, where
  coordinates run 0..1 — every wall on the sheet would have been "inside" a text
  box and the drawing filtered away. The same unit mistake the CTM bug made with
  lengths.
- Four gates: **9,342 unit tests**, db suite, typecheck, lint. No schema change.

## What the same report says is still missing

Recall on that sheet was **35–45%**: the exterior walls, the kennel runs and
dividers, and several rooms had no line on them. Precision is the half that is
working. Nothing here addresses recall, and it is the honest next question.

## Click-list

1. Open a plan sheet. Press **−** repeatedly from Fit. *Expected: it never gets
   BIGGER, and stops when there is nothing further out.*
2. Make the window wide and short, then press **Fit**. *Expected: the whole
   sheet is visible, top and bottom included.*
3. Press **Find the walls** on a floor plan. *Expected: no lines on dimension
   strings like `4'-0"`, and none on room-number tags.*
4. *Expected: a long wall that runs underneath a room label is still found.*
