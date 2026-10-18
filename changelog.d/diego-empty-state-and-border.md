### It blamed a scan it had never seen, and offered the sheet border as a wall (Diego)
`diego/empty-state-and-border`

Two defects from a click-through across four new plan sets.

## One — the empty state asserted a cause nobody had established

A sheet that found no walls said:

> *No walls found on this sheet. That is a fact about the drawing, not a failure
> — **a scanned or image-only sheet** has no lines to read.*

The click-through hit it on a drawing made entirely of line work and said so
plainly: the sheet is plainly not a scan. **The app had no idea whether that was
this sheet's reason** — it is one of several, asserted as the one.

It knows which it is: it has just counted the strokes. So it now says which:

| | |
| --- | --- |
| no strokes | *"this sheet has no line work at all, so it is an image or a scan"* |
| strokes, no pairs | *"this sheet does have line work — 50,801 lines — but none of it paired up as a wall. That happens when walls are drawn as a single line or as solid fill rather than two faces."* |

Those are different facts and different things for an estimator to do about it.
The second one is also the honest description of what was happening on that set.

## Two — the sheet border offered as a 114ft wall

The same click-through reported a group reading **`10-1/2" · 1 run · 114 ft`**,
and it was a single line down the left SHEET BORDER. One group, 114 feet,
entirely false — and the most inviting thing in the panel, because it was the
longest single run on the sheet.

**A border runs the full extent of the PAGE, and nothing inside a building
does.** On that sheet it measured ~95% of the page height, while the longest
real wall was 68% of the width — so 90% sits in a gap rather than on a judgement
call. It is compared along the run's OWN axis, because a vertical border on a
landscape sheet is short against the width and nearly the whole height.

**A/B'd on the three sheets it was reported from, before shipping:**

| sheet | before | after | dropped |
| --- | --- | --- | --- |
| Augusta permit p11 | 96 | 95 | **114ft @ 10-1/2" — exactly the border** |
| Naples p8 | 64 | 64 | nothing |
| West Herr p21 | 192 | 192 | nothing |

The `10-1/2" × 1 × 114ft` group is gone from the panel and nothing else moved.
That measurement exists because the pen filter was shipped without one and
deleted 59% of the walls.

## Verification

- 7 tests on the border filter, including the one that carries the whole risk:
  **a long exterior wall at 68% of the page is KEPT.** Dropping it would trade a
  visible wrong line for an invisible short bid.
- **6 mutations, each red.** Two were GREEN first — the viewer dropping the call,
  and the empty state reverting to blaming a scan — which is the wiring gap every
  one of these has had.
- Four gates: **9,349 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open a sheet that finds no walls but visibly has line work. *Expected: it
   says the sheet HAS line work and how much, and does not call it a scan.*
2. On the Augusta permit set, sheet A1.11, press **Find the walls**. *Expected:
   no `10-1/2"` group of one run — the left border is gone.*
3. *Expected: every other group unchanged, and a long exterior wall still found.*
