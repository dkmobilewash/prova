### Doors: flipped-leaf view copies, a legend's "NEW DOOR" sample, a radius dimension's centre mark, and a door inside a "NOT IN CONSTRUCTION" hatch are not counted (training false 92 -> 69, retired 14 -> 10, no real door lost)
`diego/door-precondition-r2`

This continues the doors exam precondition: training must reach 97% on every set, and the retired Round-23 pool 95%.
Measured on labels-snap-20261118T1020 (Round 28 training keys in) from main 668d36ba. Each fix was measured in turn,
on top of the ones before it, under the pre-registered rule: pooled false down, matched not down, no set worse.

- **A view copy whose leaves the finder read the other way round is still a copy** (`copiedIntoOtherViews`). HPL
  I-110's lighting-plan copies drew the open leaf where the partition plan has the closed one, so #1212's
  same-strike test missed them. Either leaf end now matches either leaf end under the view's offset.
  Training false 92 -> 89 (HPL 7 -> 4).
- **A symbol legend's door sample** (`legendDoorSample`): the nearest text to its right on the same line names the
  kind of door ("NEW DOOR", "EXISTING DOOR AND FRAME TO REMAIN") and carries no digit. An earlier test that took any
  digit-free DOOR lost 4 real doors: a tag split over two rows, and "DOOR TYPE; SEE DOOR SCHEDULE". This one does
  not. Training false 89 -> 87 (Bluetooth 1 -> 0, Canton 4 -> 3).
- **A hinge on a radius dimension's centre mark** (`onCentreMark`). Substation A-101's curved corners hinge on the
  mark: the R 3'-0" line reads as the leaf and the inner face as the swing. The mark is a "+" square to the leaf,
  or a small ring. An "x" at 45 degrees is not a centre mark: Joplin A-101 marks a real hinge that way, and a first
  version that took any cross lost that door. Retired false 14 -> 10 (Substation 6 -> 2); training 87 -> 86
  (SEWA 2 -> 1).
- **"NOT IN CONSTRUCTION" labels a hatched area, and the hatch must hold the swing too** (route 2). Sedgwick A22.1
  prints the label stacked over two rows, "NOT IN" / "CONSTRUCTION". A door in the hatched area's boundary wall that
  swings out of it is new work (Sedgwick's 201). The swing is read off the hatch strokes within 1 ft, because the
  hatch's 3 ft cells are coarser than a door. Training false 86 -> 69 (Sedgwick 24 -> 7).

Cumulative, matched key doors unchanged in both pools: training 85.8% -> 88.9%, retired 92.9% -> 94.8%. The
precondition still fails. Retired needs 9 false or fewer and has 10. Training is held down by SMMUSD PP1.3, whose
scope is set by keynote (1 new door, 36 existing drawn alike; a scope ruling is pending), Garden Square, Sedgwick,
Sloans and HPL.

Measured and not shipped: a walk-in box rule (a door within 12 ft of WALK-IN COOLER/FREEZER). It lost real doors
beside the box (Sloans' door 6, Holabird's X9).

Checks: unit tests in `existingDoors.test.ts` for each rule. Mutations red on this branch: the strict same-strike
test restored, the bare-DOOR label restored, any-angle crosses restored, and the swing requirement dropped.
