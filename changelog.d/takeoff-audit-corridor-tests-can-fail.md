### The corridor tests can now fail

A door-evidence rule was built and reverted on 2026-10-17: it fixed the one
doorway the corridor guard costs on a real plan and took the bench from 111
missed walls to 271, bridging 651 of 1,087 bounded gaps and drawing wall
across the bench's 6.4 ft corridors 253 times.

**Every corridor test in `mergeWalls.test.ts` passed the whole time** — 42 of
42 — because they call `mergeWalls(walls, feetPerUnit)` with no drawing, so the
rule's code never executed in any of them. A corridor test that cannot reach
the code deciding corridors is the vacuous green this repository keeps paying
for, and the bench was the only instrument that saw anything.

`mergeWalls` takes the sheet's strokes now. **Nothing reads them**, and the
parameter's docstring says so in as many words: it exists ahead of the rule so
the corridor scenes have something to hand it. Two scenes were added — a door
swing drawn beside a corridor, and a door at a corridor's mouth, which is the
dangerous case (hinged at the gap's own end, with a leaf about the corridor's
width, so a rule asking "is there an arc hinged near one end of this gap, about
this wide" says yes).

**Proved rather than claimed.** The reverted rule was re-applied locally and
the suite re-run: 1 failed, 43 passed, and the failure is the mouth scene. It
was then removed again. `openingEvidence.ts` is deliberately not committed —
dead code that looks like a feature is worse than none.

The swing-beside-a-corridor scene stays green under that rule, and its comment
says so. It is kept as a regression case rather than tuned until it bites,
because a fixture adjusted until one particular wrong rule fails it is fitted
to that rule rather than to the hazard.

`NOTES.md` gains a "where accuracy stands" section: the fixtures at 15 of 17,
the bench's three bars with its 111 missed walls grouped by cause, Cedar
Hollow's three numbers, the real-plan totals with a note that missing and extra
are undefined there for want of a key, and the four open items with why each is
parked.

Of the bench's attributed loss, 2,210 ft of 5,595 is one raster sheet refused
honestly. Of the remaining 3,385 ft, **55% is a neighbouring line claiming one
of a wall's faces first** and 32% is wall read as hatching.
