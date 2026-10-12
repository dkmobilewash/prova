### A sentence a find-and-replace broke, and one number rendered two ways (Diego)

`diego/two-renderings`

Both found by clicking the app after #735 shipped, both introduced by me, and
**both had a passing test sitting next to them.**

#### One — the headline read as nonsense, and still made the claim it was removing

#735 stopped the panel promising *"Each group is drawn on the sheet in its own
colour"*, because there are six colours and the tag split made seventeen groups.
The replacement was applied with a find-and-replace that took the first half of
the sentence and left the second, so the app shipped:

> Found 63 runs of wall. **Hover a row to pick its sheet in its own colour** —
> check it sits on real walls before adding it.

Nonsense, and it still says *in its own colour*.

**The test passed because it asserted two fragments** — that the old phrase was
gone and the new one present. Both true of that line. A test of halves cannot
see a sentence. It now reads the whole headline and asserts the CLAIM is absent,
not a substring of it.

#### Two — a row headed 7-3/8" whose sentence said 7-7/16"

`wallGroups.ts` carried its own inches-to-fraction helper, rounding to the
nearest **sixteenth**, while the row heading above it uses `inchLabel`, which
rounds to the nearest **eighth**. One wall, two numbers, one directly above the
other on screen:

> **7-3/8"** · 3 runs · 41 ft
> *Nothing on the drawing names these and no wall type you have is 7-7/16"
> thick.*

The local helper is gone. This is the second list CLAUDE.md warns about in
miniature, and it takes the same fix: **there is one renderer.** The test pins
the sentence to `inchLabel`'s own output at a thickness that lands between
eighths, which is the only place the two could disagree.

#### Checks

Preflight green, 10,033 tests, no migration. **Four mutations, four red**,
including the exact defect as shipped.

#### What the same run confirmed about #735

Worth recording beside the defects, because the change itself worked:

| | before | after |
| --- | --- | --- |
| rows shown | 8 | **12** |
| hidden footage | **488 ft**, behind a sentence | **70 ft**, behind a control |
| order | per cluster | **463, 330, 250, 212, 140, 117, 74, 60, 49, 43, 41, 32** — strictly descending |
| expanded | — | **17 rows**, every one with a button |
| total | 1,879 ft / 63 runs | **1,880 ft / 63 runs** — conserved, the foot being rounding across 17 rows |
