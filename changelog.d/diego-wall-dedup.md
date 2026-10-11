### One physical wall is found once, however many faces it is drawn with (Diego)

`diego/wall-dedup`

A hand count on School-01 reported the drawing's own tag **`EXT-1` on three
different thickness groups at once** — 4-7/8", 6-5/8" and 10-3/4". One assembly
cannot be three thicknesses. The tagging was right every time; **the exterior
wall was being found three times.**

#### Why an exterior wall and not a partition

A partition is drawn as **two** lines, so there is one possible pairing and no
way to go wrong. An exterior wall is drawn as **four or five** — outer finish,
sheathing, stud face, inner face. `wallsFromStrokes` takes the widest valid pair
as the wall (correctly, and deliberately — #649) and consumes those two faces.
**The leftover faces in the middle then pair with each other**, and are reported
as a second, thinner wall lying exactly on top of the first.

Measured on the face offsets a real envelope uses, one 40 ft wall:

| faces drawn | walls returned | feet reported |
| --- | --- | --- |
| 2, an interior partition | 1 | 40 — correct |
| 4, brick and stud | **2** | **80** |
| 5, as measured on the sheet | **2** | **80** |
| 6, with a column grid line | **3** | **120** |

#### Over-reporting is the direction that reaches a bid

An under-report is caught by eye: a wall with no line on it is visible on the
drawing. This is not. **Every copy sits exactly on a real wall**, so the overlay
looks perfect while the footage is double — and the click-through that found
four real defects this week could not have found this one.

#### The fix, and the first draft of it that was worse

A run whose centreline lies **inside** another run's thickness, parallel and
overlapping, is the same wall found twice. Keep one.

Which one is the whole question. **The first draft kept the first-emitted, and
that was wrong in a way the mutation run caught:** faces are walked
longest-first, so a 115 ft **column grid line** is reached before the 40 ft wall
it runs past, and its pairing is emitted first. That version returned one wall
of 10.92in where the drawing has an 8.88in one — deduplicated correctly, kept
the wrong copy, and **worse than the duplicate it replaced because the footage
now looks right.**

The pairer already decides whether a pair was balanced (`BALANCED_FACE_RATIO`,
the test that tells a wall's second face from a grid line) and was throwing the
answer away. It is recorded now, and balanced findings are considered first. On
that input the result is better than before this PR: one wall, 8.88in, and the
10.75" grid-line group is gone.

#### What this does NOT collapse

Each is a test, because the cost of getting this wrong is a wall leaving the
bid: two walls either side of a corridor, a furring wall against a thick one,
two walls end to end on the same line, walls crossing at a right angle, a wall
whose centreline is just outside the other's thickness, and — found by mutation
— **a wall crossing at a shallow angle**, which is School-01's own 17.5° wall in
Conference 118.

#### Checks

502 tests, eval unchanged (0 phantom, 0 missed on all seven cases — they are
two-face walls, so the dedup correctly does nothing). **Twelve mutations, eleven
red.** The twelfth is written up in the code rather than dressed up with a test:
reading the band from the new wall instead of the kept one differs only where
two walls occupy the same three inches, which no assembly does.

#### What this changes on a real sheet

**The footage will go DOWN**, and down is the correct direction — some of what
School-01 reported is not there. By how much is not known from here and is the
next hand count.

No schema change.
