### 9-1/2 inches is not a wall anybody builds (Diego)

`diego/furring`

The wall finder works on geometry alone, and its rule for a layered wall is
written into `wallVectors.ts`:

> What an estimator measures is finish to finish, so the widest valid pair is
> the wall and the narrower ones are its layers.

That is right for one wall drawn in layers and **wrong where two assemblies
touch.** 1-1/2in furring on an 8in block wall is drawn as three lines, so the
pairs are 8in (the block), 1-1/2in (the furring) and 9-1/2in (across both).
Widest won:

| drawing | before | after |
| --- | --- | --- |
| 8in block + 1-1/2in furring | **one wall at 9.50in** | **8.00in** |
| EXT-2, four lines | 8.13in | 8.13in (unchanged) |

9-1/2in is a thickness on no schedule, priced as an assembly nobody ordered.
Reported from School-01's A-101 as "the furring paired with the concrete-block
face and reported as a wall on the block".

#### The schedule is the only thing that can separate them

Thickness cannot. A layered exterior's widest span IS its wall, and the finder
must keep reading it that way. What distinguishes the two cases is printed on
the drawing — **8 and 1-1/2 are on the partition schedule, 9-1/2 is on
nothing** — and `wallTypesFromSchedule` already extracts it. So
`wallsFromStrokes` takes an optional `knownThicknessesIn`, and with it:

1. prefers the widest pair whose thickness is a type this company builds;
2. **lets the 2.4in floor defer to that list.** The floor exists because, knowing
   nothing about the building, a gap that thin is more likely a doubled stroke
   than a wall; once the schedule names 1-1/2in, that doubt has been answered
   for that thickness and for no other;
3. refuses a pair that is a wider scheduled wall's own **layer line**.

Without the list the finder behaves exactly as before, which is why the list is
passed in rather than guessed at inside.

#### Rule 3 is not optional, and the bench is what found it

On this schedule a 1-1/2in furring wall is **thickness-identical to the inside
of both exterior types**:

| type | thickness | internal gap |
| --- | --- | --- |
| F1 furring | 1.5in | — |
| EXT-1 | 8.875in | **1.625in** |
| EXT-2 | 8.125in | **1.500in** |

Measured on one holdout sheet with rule 2 and not rule 3: **438 ft of runs in a
1.68in cluster, on a drawing whose only real furring is 40 ft — and that 40 ft
was recorded MISSED.** D1, a 14-1/2in chase wall, brings the same defect one
size up: its inner pair is about 5in, which is C1's 4-3/4in within slack, and it
cost 158 ft of the holdout's over-run reported twice.

Position separates them. Furring is applied TO a wall and sits outside it; a
layer line sits between its wall's own faces. `enclosedByAScheduledWall` asks,
of a pair, whether some third line makes a scheduled wall with one of its faces
while the other lies between the two.

**It cannot reproduce on a clean synthetic wall**, which is why no unit test
caught it: one unbroken outer face is consumed by the wall's own pair and
nothing is left to form the thin one. A real sheet breaks that face at every
window and corner. The test uses a broken face for exactly that reason.

#### How hard the guard is allowed to bite, and why

A sub-floor pair that is enclosed is **refused outright** — its only claim to
being a candidate was the schedule, and a layer line is not that wall.

A pair at or above the floor only loses its schedule **preference**; it stays
eligible under the rules that were already here. That asymmetry is measured, not
tidy: `enclosedByAScheduledWall` scans every parallel line inside the thickness
window, so on a busy sheet a real wall can sit a scheduled thickness from
another and look enclosed. Refusing those outright takes Mesa Ridge to
**58,438 ft found — below the 59,538 it started at** — and A-101 to 1,798 from
1,853.

#### Graded per wall, against the key's centreline

| | Mesa Ridge | | holdout (20) | | A-101 | |
| --- | --- | --- | --- | --- | --- | --- |
| | before | after | before | after | before | after |
| found | 59,538 (76.3%) | **60,453 (77.5%)** | 31,088 (94.1%) | **31,377 (95.0%)** | 1,853 (85.6%) | **1,887 (87.2%)** |
| not on a wall | 4,500 | **4,432** | 637 | 698 | 111 | 111 |

**Mesa Ridge improves on both counts.** Found footage rises on all three sets.
The holdout's not-on-a-wall rises 61 ft against 289 ft gained, and A-101's is
flat — **stated rather than rounded away.** A-101's 33 ft sits on the key's
concrete-block walls, which are out of drywall scope; what changed there is that
it is now read at the block's own thickness instead of as a 9-1/2in wall that
does not exist, which is what the tests pin.

#### What this does NOT do

**The furring itself is still missed**, and there is a test that says so rather
than a silence. Its two faces are the block's inner face and the furring face,
and the block has already taken the inner face — a face belongs to one wall. In
construction it belongs to one wall per SIDE.

Allowing that was built and measured and it is not worth shipping: about 100 ft
of found footage, against roughly **2,900 ft on Mesa Ridge and 2,000 ft on the
holdout** of footage that is not on any wall, because every face in the drawing
gains a second chance to pair with something that is not its partner. That is
the next piece of work and it needs a way to admit the second side of a face
without admitting all of them.

#### A bound worth stating about the holdout

This fix was iterated against the holdout's numbers more than once while the
enclosure rule was being worked out, which is not what the holdout is for —
"tune on Mesa Ridge, validate on the holdout". Its remaining 61 ft should be
read as a weaker independent check than usual. The next change to this code
should be tuned on Mesa alone.

#### Checks

Preflight green, 10,129 tests, no migration. **Seven mutations, seven red** —
the option ignored, the preference removed, the floor no longer deferring, the
enclosure test removed, enclosure tested in one direction only, the slack
widened to an inch, and **the product no longer passing the schedule at all**,
which was blind until `wallFinderSchedule.test.ts` existed: every test of the
behaviour passes the list in itself, so the one call site in the app could be
emptied with 240 tests still green.
