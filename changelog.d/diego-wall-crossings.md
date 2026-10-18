### #725 drew wall through a corridor, and no width can tell the two apart (Diego)

`diego/wall-crossings`

**Caught by a hand count the day after it merged.** School-01 A-101, the same
region as before: seven runs crossed the 5'-7" corridor in front of exam rooms
110–114, joining each north partition to its matching south partition **across
open floor**. The grid B wall became one 91-foot run from exterior to exterior.
About **39 feet of wall nobody can build** in one region, and the same again on
the south side.

That is an over-report, which is the direction that reaches a bid. #725 took
recall from 84% to 100% on that region and made false positives non-zero for the
first time — a bad trade, and the one I said I would refuse.

#### Narrowing the bound would not have fixed it

An egress corridor runs to **3'-8"**. A double door is **6'-0"**. **A corridor is
narrower than a door**, so no width separates them: tighten the bound and it
refuses real doors while still admitting tight corridors.

#### What does separate them is on the drawing

A door is a hole in one wall — nothing crosses it. **A corridor has its own two
walls running across the ends of the gap**, because that is what makes it a
corridor rather than a hole.

| at the gap | | |
| --- | --- | --- |
| a **door** | no perpendicular wall at either jamb | join |
| a **column** | no perpendicular wall | join |
| a **T-junction** | one perpendicular wall, the run continues | join |
| a **corridor** | a perpendicular wall at **both** ends | refuse |

The T-junction row is why "any perpendicular wall nearby" would be the wrong
rule: a wall meeting this one side-on does not stop it, and refusing there would
put back the fragmentation #725 exists to remove.

**It degrades the safe way.** If the corridor's walls were not detected, nothing
bounds the gap and the join goes ahead — the same answer as before this existed,
rather than refusing everything on a missing input.

#### Checks

478 tests. **Eight mutations, seven red** — the crossing test never consulted
(the bug as shipped), one perpendicular wall being enough, the same wall counting
at both ends, only one end examined, perpendicularity not required, the distance
read in page units, and `distanceToSegment` measuring to the infinite line.

**Three were green first, and two were real holes in my tests.**

- Every scene I had written only contained *perpendicular* walls near a gap, so
  dropping the perpendicularity filter changed nothing. A chase or furring wall
  running **alongside** a doorway is two walls near the two ends and is not a
  crossing — that case exists now.
- `distanceToSegment`'s clamp was unexercised. **Gridlines make this the normal
  case, not a freak one**: a perpendicular wall elsewhere in the building lies on
  a line passing right through this gap, and without the clamp a wall fifty feet
  away refuses a doorway here.

The third is **equivalent and the code says so**: excluding wall `j` is redundant
against the perpendicularity test, since `j` is collinear with `i` by then and
can never be perpendicular to it.

**And one of my own tests was vacuous and is now real.** The "two different
walls" case used a *parallel* wall, which the perpendicularity filter discards
before the branch it was meant to exercise. It is a 2-foot gap with one
perpendicular wall crossing it — a doorway at a T-junction, where one wall sits
within the bounding distance of both ends — which is the only way that branch is
reachable.

#### Still open from the same count, and NOT fixed here

- **The opening count is inflated.** The corridor-wall run reports 16 openings
  where the stretch has 5 doors; the rest are gaps at T-junctions and columns,
  and some were the corridor crossings this PR removes. The count will drop, and
  whether it drops to 5 is the next thing to read.
- **The south corridor wall lost its line entirely.** Unexplained. The leading
  hypothesis is this change's own doing: joining makes runs longer, and a longer
  run is likelier to trip `wallsNotTheSheetBorder`'s span test. Not confirmed,
  and it needs the sheet.

No schema change. Preflight green.
