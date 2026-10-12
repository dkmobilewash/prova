### The panel said a wall type was a thickness it is not (Diego)

`diego/sentence-says-its-thickness`

Caught by reading the panel against the partition schedule on School-01's
A-101, 2026-10-11. Two contradictions on one screen:

> "**B1** is the only wall type you have at **7-3/8"**" — B1 is recorded at 7-1/4"
>
> "3 wall types at **4-7/8"** (A1, A2, **C1**)" — C1 is recorded at 4-3/4"

A type is matched to a group within `THICKNESS_SLACK_IN`, a quarter inch, so
the two numbers legitimately differ. **Neither number was wrong on its own —
the sentence joining them was**: both took the group's MEASURED thickness and
attributed it to the TYPES.

An estimator who checks the panel against the schedule finds a contradiction
the app invented, which is the fastest way to lose their trust in every other
number on the screen.

#### Say the measurement once, and the type's own number where it differs

| | before | after |
| --- | --- | --- |
| one candidate | "B1 is the only wall type you have at 7-3/8"" | "They measure **7-3/8"**, and the only wall type you have near that is **B1 at 7-1/4"**" |
| several | "3 wall types at 4-7/8" (A1, A2, C1)" | "They measure **4-7/8"**, and you have 3 wall types near that: **A1, A2, C1 at 4-3/4"**" |

**The condition is what the reader would see**, not a tolerance of its own: the
thickness is spelled out exactly when `inchLabel` would render it differently.
So the sentence never says "B1 at 7-3/8"" beside "they measure 7-3/8"", and
never hides a difference somebody could check against the schedule.

#### One mutation is green and stays green

Deleting the null-thickness branch in the helper changes nothing. Both
sentences take their candidates from `typesAtThickness`, which already drops a
type with no thickness, so **nothing can reach the helper with one**.

It is kept rather than deleted, and written down rather than trusted:
`MatchableWallType.thicknessIn` IS nullable, so removing the branch means
asserting non-null — a worse lie than a line that never runs. If a
name-filtered candidate list ever reaches these sentences, that branch is what
stops "A1 at NaN" reaching a bid.

#### Checks

Preflight green, 10,091 tests, no migration. **Five mutations, four red** —
including both sentences reverting to the defect exactly as shipped, the type's
thickness never being shown, and it being shown when it adds nothing — and the
fifth green for the reason above, named in the code beside it.
