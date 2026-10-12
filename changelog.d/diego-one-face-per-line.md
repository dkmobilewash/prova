### A face interrupted by a hole is one face (Diego)

`diego/one-face-per-line`

A CAD export breaks the line a wall's face is drawn with — at every vertex, at
every window, at every door. Its near face and its interior layer lines come
through whole. The pairing loop walks faces **longest first**, so the whole
lines are reached first, pair with each other, and consume themselves; the
broken face's pieces then arrive to find the partner they needed already spoken
for, and the wall is reported at whatever the leftovers make.

#### The symptom was never missing footage, it was the wrong thickness

Graded against the key's own thicknesses rather than its footage — a measure
this bench could always produce and nobody had asked it for:

| | before | **after** |
| --- | --- | --- |
| Mesa Ridge reported at a thickness on **no** schedule | 21,405 ft (30.2%) | **13,644 ft (18.3%)** |
| holdout, same | 9,470 ft (28.1%) | **8,432 ft (24.2%)** |

The biggest single offender was **about 6-1/2in with 9,579 ft on Mesa Ridge**.
Both exterior types have an internal gap of 6.625in — EXT-1's stud face to its
inner face, EXT-2's outer face to its inner layer — so that is the stud cavity
being sold as the wall.

`wallVectors.ts` has described this exact failure since it was written:

> the envelope was being found and then reported at 6.6in — 297 ft of it on one
> sheet — against a true EXT-2 of 8-1/8in … A wall at the wrong thickness is
> priced as the wrong assembly, which is a worse failure than not finding it

It attributed that to taking the first valid partner instead of the widest. That
fix was right, and it could not reach this case: here the true partner is not a
candidate at all.

#### Read off the sheet, not reasoned about

At a wall the key calls 8-1/8in and 127.33 ft long, the long lines present are:

```
y=68.773  len=128ft
y=68.898  len=128ft   gap  1.50in
y=69.778  len=230ft   gap 10.56in
```

The wall came back at **10.56in — paired with a 230 ft line** on a 128 ft wall,
a gridline crossing the whole sheet, because its own far face was in
window-sized pieces. And a misread wall cannot shield its own layer lines:
`enclosedByAScheduledWall` only recognises an enclosing wall at a **scheduled**
thickness, so the 1.50in pair above walked through as furring. One cause, three
symptoms.

#### `oneFacePerLine`

Joining the pieces first is not a heuristic about walls, it is a statement about
faces. It groups segments by direction and perpendicular offset, then joins
along the line, and runs **before** the 2 ft input filter — a face chopped into
1 ft pieces has every piece under that floor while the face itself is 120 ft of
building.

**Both bounds are measured, and both matter more than they look.**

`SAME_FACE_GAP_FEET = 2`, swept:

| gap | Mesa found | Mesa not-wall | holdout found | not-wall |
| --- | --- | --- | --- | --- |
| 8 ft | 57,909 (74.2%) | 11,735 | 31,362 (95.0%) | 1,442 |
| 4 ft | 63,624 (81.5%) | 5,120 | 32,004 (96.9%) | 644 |
| **2 ft** | **63,784 (81.7%)** | **5,017** | **31,907 (96.6%)** | **607** |
| 0.75 ft | 63,478 (81.3%) | 4,961 | 31,831 (96.4%) | 607 |

**At this bound a 3 ft doorway is NOT bridged**, which is worth saying because
the obvious reading of the function is that it would be. 4 ft does bridge one
and is worse on Mesa Ridge — the set this is tuned on — and worse on thickness
(21.2% against 18.3%). A building aligns its walls, so the wider the bound the
more often it joins two different walls on one grid line instead of two pieces
of one face, and 8 ft is a catastrophe.

`SAME_FACE_OFFSET_FEET = 0.004` (0.048in) is set by a real pair of types, not a
round number: the bench's "A1 and C1 thicknesses 1/8in apart" trap. Drawn end to
end on one centreline their faces sit 1/16in apart, and anything looser merges
them into one run at about 4.81in — a thickness neither of them is, across the
length of both. Plotting jitter here is about 0.005in, so this absorbs the
jitter with an order of magnitude to spare and nothing else.

#### Footage, since that is what gets billed

| | Mesa Ridge | | holdout (20) | | A-101 | |
| --- | --- | --- | --- | --- | --- | --- |
| | before | after | before | after | before | after |
| found | 60,453 (77.5%) | **63,784 (81.7%)** | 31,377 (95.0%) | **31,907 (96.6%)** | 1,887 (87.2%) | **2,010 (92.8%)** |
| not on a wall | 4,432 | 5,017 | 698 | **607** | 111 | 141 |

**+3,331 ft on Mesa Ridge, +530 on the holdout, +123 on A-101.** The holdout
improves on both counts. Mesa's not-on-a-wall rises 585 ft against 3,331 gained
and A-101's by 30 against 123 — **stated rather than rounded away**, and the
first change in this sequence whose recall gain is large enough that the ratio
is better than 5:1.

#### The existing eval it broke, and why the fixture was right

`wallDetection.eval.test.ts` failed on `two-rooms-shared-wall` at FOUND 3 of 7.
That case draws a 30 ft and a 25 ft wall abutting at x=40, and they now come
back as **one 55 ft run** — which is what the paper shows, and the reported
total was **170.0 ft against a true 170.0 ft**, exact.

The grading matched each run to ONE truth wall by midpoint, so a 55 ft run
matched neither drawn wall: its midpoint is at 37.5 and theirs are at 25 and
52.5. **The fixture was not wrong and its expectation of 7 did not change.** A
run now claims every truth wall it covers and its span is judged against the
total of those walls, so the grades stop depending on how the finder chooses to
cut a line up. Phantoms, misses and overshoots keep their meanings; the suite
passes at 7 again.

#### Checks

Preflight green, 10,139 tests, no migration. **Eight mutations, eight red** —
the join removed, the join moved after the length filter, the gap bound opened
to 8 ft and closed to 0, direction left un-normalised, the offset tolerance
widened to half a foot and widened just past an A1/C1 face gap, and the angle
test dropped.

Two of those were blind at first and both were the fixtures' fault: the
direction test used a line through the origin, where the offset is 0 whichever
way it points, and the length-filter ordering cannot be seen through
`oneFacePerLine` alone — it needs a wall whose every piece is under the floor,
end to end.
