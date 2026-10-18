### The wall was 40 feet and the file said 20 (Diego)
`diego/wall-ctm`

#649 shipped wall detection from a sheet's vector strokes and I found a real
defect in it ten minutes after it merged, while working out what to ask of a
real CAD export. **It halves wall lengths**, and no test in the repo could have
caught it.

A path's coordinates are in the space of the CURRENT TRANSFORMATION MATRIX at
the moment it is drawn, and pdfjs reports that matrix as its own operators
rather than baking it into the numbers. `sheetStrokes.ts` applied only
`viewport.transform` and ignored `OPS.transform` (a `cm`), `OPS.save` and
`OPS.restore` (`q`/`Q`). Measured on a sheet carrying two walls whose
content-stream numbers are IDENTICAL, the second wrapped in
`q 2 0 0 2 0 0 cm … Q`:

    operators: { setLineWidth: 1, constructPath: 4, stroke: 4,
                 save: 1, transform: 1, restore: 1 }
    path coords: [100, 600, 280, 600]     // 180pt, and 180pt on paper
    path coords: [50, 150, 230, 150]      // 180pt, but 360pt on paper

So a 40ft wall reads as 20ft, and its thickness halves too — which can push it
outside the 0.2–1.5ft window and make it vanish instead. Both failures are
silent, and the footage one is the expensive kind: it produces a plausible
number on a bid.

**The reason this shipped is the interesting part, and it is the fourth member
of a family CLAUDE.md already documents.** It was not missed by a weak
assertion — it was *unreachable by every assertion*, because
`syntheticSheet.ts` writes its own content stream and never emitted a `cm`.
Beside "nothing is missing from a directory you do not walk" and "nothing is
missing from a list nobody imports", this is **nothing is ever missing from a
question nobody is asking** — arriving as a fixture that cannot pose the
question rather than a census that cannot see the file.

Real CAD poses it constantly: a Form XObject always carries a matrix, and Revit
and AutoCAD both wrap drawing content in one. So this would have been the FIRST
thing a real export told us, and the fix is better spent before that sheet
arrives than after.

**The fix is a CTM stack** — `q` pushes, `Q` pops, `cm` concatenates onto what
is in force (so nested transforms compose, which is how a Form XObject inside a
scaled block lands in the right place), and each path is mapped through
`Util.transform(viewport.transform, ctm)` in that order.

**And the generator can now ask.** `SheetSpec.wallTransformScale` draws the
walls under a `cm`, with the same truth in both arms — the two sheets are
identical on paper and differ only in whether the reader must honour the
matrix, so the EQUALITY of the two results is the assertion.

**Five mutations, and the fourth one is why this entry is worth reading.**

| mutation | result |
| --- | --- |
| CTM ignored — the shipped defect, restored exactly | RED, 1 wall of 4 |
| `transform` dropped — a `cm` stops composing | RED, 1 of 4 |
| CTM applied in the WRONG ORDER (matrices do not commute) | RED, 1 of 4 |
| **`save`/`restore` dropped — a matrix leaks past its `Q`** | **GREEN at first** |
| the fixture stops emitting a `cm` — the arm must not go vacuous | RED |

The fourth came back green on a suite written for exactly that defect, and the
fixture was the reason again: every wall sat inside one `q … Q` with the content
stream ending at the `Q`, so a reader that never POPS the matrix scores
identically to one that does — there is nothing left to draw wrongly. The last
wall is now drawn AFTER the restore at plain scale, which is what real CAD does
all over a sheet, and the mutation reds at 3 walls of 4.

**Typecheck caught one more guess, recorded because it is the cheap half of the
same lesson.** The first version handled an `OPS.setTransform`, which does not
exist: PDF has no replace-the-matrix operator, `cm` always concatenates, and
`q`/`Q` are the only way back. `error TS2551: Did you mean 'transform'?`

Four gates green: 9,088 unit tests, 586 files.
