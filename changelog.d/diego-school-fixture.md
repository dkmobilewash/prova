### The hand count is a fixture now, and it immediately found that #726 does not work (Diego)

`diego/school-fixture`

Every genuine defect in the takeoff work this week was found by **somebody
looking at a screen** — the sheet border billed as wall, a doorway ending a
wall, a wall drawn through a corridor. None was found by a test here. That is
not luck; it is what the tests were asking. They checked that the code did what
I intended, which is a different question from whether the answer is right.

So the hand count is a scene with a known answer, and the assertions are about
the **output**.

#### It is a reconstruction, never the drawing

The customer's plan set is confidential and does not enter this repo. What is
here is the geometry as counted — nine walls, 233 feet, five doors in the
corridor wall, three in the back wall, a column on the grid line, a 5'-7"
corridor with a matching block of rooms beyond it — and the arithmetic agrees
with the count exactly:

```
7 verticals × 17 ft  = 119 ft   (grid B, grid D, five acoustic partitions)
2 horizontals × 57 ft = 114 ft  (corridor wall, back wall)
                        ------
                        233 ft  across 9 walls
```

**A pass here is not a pass on the drawing it came from** — no drafting noise,
no line-weight variation, no dimension strings crossing walls. Same caveat
`wallCases.ts` puts on itself.

#### What it found before it was even finished

**#726 does not fix the corridor on this scene.** That PR added `gapIsCrossing`
— a corridor has perpendicular walls at both ends of the gap, a doorway has none
— and here it fires and does not help: **95 gap checks, 23 refusals, and ten
runs still cross.**

Measured rather than argued. With the opening-join off the scene produces
`H32 H57 H57 H57` and **no crossings**; with it on, four `H57` — the doored
walls correctly whole — **and six `V40`**, where 40 ft is exactly
17 + 5.583 + 17: a room, the corridor, and the room opposite.

**Union-find is transitive.** Refusing the pair either side of a corridor does
nothing when a third fragment bridges them into the same group. Moving the check
to the spans loop (the binding gate) was tried and **refused zero joins here**,
so it was removed rather than left in as an unexercised safeguard.

That is recorded as **`it.fails`**, not a skip. A skipped test is a note nobody
reads; this one asserts the defect is still there, keeps CI honest while it is,
and **goes red the moment somebody fixes it**. Proved by mutation — weakening
the assertion so the test would pass turns the suite red.

#### Three bugs in the fixture itself, each of which faked the defect

Worth recording because each produced a convincing wrong answer:

- **The south block was drawn off the page.** The synthesiser puts the drawing
  origin 80 points in from the corner, so a block at −17 ft is clipped. The
  fixture reported six crossings against code that refuses them, and the scene
  was broken rather than the detector.
- **Doors landed exactly on the partitions.** Even spacing put five of seven
  verticals in a doorway — a layout no building has. Doors go mid-bay, on the
  room's frontage, clear of the partitions.
- **The "spans the corridor" probe was too strict**, so fragments that cover
  almost all of it read as not crossing.

The first two are also a real finding about `gapIsCrossing`: **a door at the
exact point where a partition meets a corridor wall means there is no wall there
to find**, so that join would go through. Rare enough that nothing guards it,
written down so the next person meets it as a known edge.

No schema change. Preflight green.
