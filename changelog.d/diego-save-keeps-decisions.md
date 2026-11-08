### A box on the answer key no longer reverses decided walls

Hutto A102 (Chrome, 2026-11-08, main 3faf4ddc): after "Restored 450", the save
wrote 13 accepted walls (~272 ft) as not-a-wall, though nobody had changed a wall
decision.

**Cause.** The answer-key box: a bare drag rejected every candidate whose
midpoint it caught, decided or not, and a bare drag is how every other viewer
pans. The 13 are exactly the accepted walls whose midpoints fall in two
rectangles that hold no other accepted wall. Replaying the old gesture with
those two boxes on the original file reproduces Chrome's file verdict for
verdict.

Ruled out on the way, by test rather than by reading:
- the restore itself (239 walls on Hutto's own geometry, 450 of 450 matched);
- the save path (it writes the state as is);
- typing (it touches types only);
- the duplicate rule (it pairs none of the 13, with or without the sheet's strokes);
- a re-detect, a sheet change and a second Run takeoff (239 each time, in the browser).

**Fix.**
- **`sweepVerdict`:** a box decides only candidates still unreviewed. When it
  leaves decided ones alone, it says how many. Reversing a decided wall stays a
  deliberate A or R on it. The panel's hint now reads "drag a box to reject the
  undecided".
- **Draft restore** (a hole of the same kind, found while hunting; not this
  one): "Restore unsaved review" put every draft verdict over the restored file.
  Now a draft value equal to the finder's starting mark (unreviewed, or
  not-a-wall for the shorter of a duplicate pair) yields to a decision already
  on screen.

**Tests.** `answerKeyReview.test.ts` and `reviewDraftKeepsSaved.test.ts` cover
both. A local-only replay on Hutto's own files restores 239, applies the two
boxes and still has 239; its control shows the old gesture gives Chrome's exact
226. Both mutation-tested.
