### A corridor's two sides are not the same length (Diego)

`diego/wall-recall-face-ratio`

`MAX_FACE_LENGTH_RATIO` was 3, and its own comment named the case it then
rejected:

> 3 is generous — **a wall whose far end is interrupted by a doorway is drawn as
> a long face and a short one**

A corridor is that shape at its worst: one side runs continuously, the other is
cut into pieces by every door off it, so each piece pairs against a face many
times its length.

#### Traced, not inferred

Found on School-01's A-101 by following one 12 ft face the pairer refused:

```
A  12.21 ft   y=0.279773   pen 0.70
B  53.25 ft   y=0.281184   pen 0.70
thickness  4.87 in   ← A1
overlap    12.21 ft   ← 100% of the shorter face
```

Parallel, thickness, overlap and minimum length all pass. The pair died at
`53.25 / 12.21 = 4.36 > 3`. Confirmed by isolation: fed those two segments
alone, `wallsFromStrokes` returns **zero** walls.

#### Swept on the bench, both sets, watching both numbers

Graded per wall against the key's **centreline**, with footage that is not on
any in-scope wall reported separately — because a total can land while a miss
and a phantom cancel.

| ratio | Mesa found | Mesa not-on-wall | holdout found | holdout not-on-wall |
| --- | --- | --- | --- | --- |
| 3 | 51,558 (66.1%) | 4,096 | 23,491 (71.1%) | 531 |
| **5** | **52,109 (66.8%)** | **3,928** | **24,057 (72.8%)** | **534** |
| 8 | 52,094 | 3,949 | 24,086 | 534 |
| 13 | 52,125 | 3,941 | 24,092 | 534 |

**5 is the knee** — 8 and 13 buy nothing and only widen what can pair.

- **+551 ft found on Mesa, +566 ft on the holdout.**
- Mesa's not-on-a-wall footage **fell by 168 ft**: pairing the right faces stops
  a wrong pairing winning them.
- The holdout's rose by **3 ft** against 566 ft gained — 0.6%, noise, and
  recorded rather than rounded away.

On A-101 alone: found **1,825 → 1,853 ft** (84.3% → 85.6%), missed 339 → 312,
and **not-on-a-wall unchanged at 111 ft**. The face-length-ratio mechanism
leaves that sheet's loss list entirely.

The 13-fold sheet-border-against-title-block case the constant was first
measured on is still rejected, with margin, and there is a test for it.

#### The mutation that was blind

Stretching the returned run from the overlap to the whole long face left every
test green: `lengthFeet` is computed from the overlap, so it stays right while
the drawn geometry runs past the wall. That is precisely the "runs carrying
past their own wall" the bench counts as not-on-a-wall, and a length assertion
cannot see it. The test asserts the geometry now.

#### Checks

Preflight green, 10,095 tests, no migration. **Four mutations, four red** — the
ratio back to 3, the ratio opened to 13, the test removed, and the run
stretched past its wall.
