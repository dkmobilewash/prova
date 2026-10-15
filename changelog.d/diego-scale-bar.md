### The graphic scale bar is not a wall, and only its numbers can say so (Diego)

`diego/scale-bar`

A click-through on School-01 reported a **5-3/8" group holding one 32 ft run**,
drawn exactly on the bar marked **0 · 4 · 8 · 16 · 32** beneath the plan. 32 ft
of billable-looking wall, on a ruler.

It had been there the whole time. It only became visible when #730 removed the
group above it and promoted this one out of "and N smaller groups" — which is
its own small lesson about what a truncated list hides.

#### Nothing that measures the LINES can catch it

A scale bar is two long parallel lines a wall-thickness apart. That is the
definition of a wall here, so every filter downstream passes it honestly:

| | |
| --- | --- |
| `wallFromPair` | parallel, overlapping, 2-12in apart — passes |
| `minLengthFeet` | 32 ft, far over — passes |
| `wallsInTheBuilding` | sits just below the plan, inside the cluster |
| `wallsNotLettering` | only drops runs **shorter** than 4 ft |
| `wallsNotTheSheetBorder` | nowhere near the edge |
| `inAHatchSeries` | it is a pair, not a series |
| the template filter | the bar changes with each sheet's scale |

Tightening any of those to catch it would cost real walls. **What distinguishes
a scale bar is not its geometry — it is that somebody printed a ruler's numbers
along it.**

#### The test is the zero

Three or more bare numbers lying along the run, close to it, ascending, and
**starting at 0**.

The zero is what makes this safe rather than clever: no wall on any drawing has
a `0` printed an inch from it. Room numbers run 110, 111, 112 and never start at
zero. A dimension string reads `30'-0"` and is one item, not a series. A grid
line is numbered once, at its bubble.

Each of those is a test, with the geometry held identical and only the numbers
changed — including the control that matters most: **the same 32 ft run in the
same place, with no numbers, is still a wall.**

#### Checks

Preflight green, 10,020 tests, no migration. **Nine mutations, nine red** — but
one only after a case was added, and it is the one worth recording:

> **deleting the call site left all sixteen cases green**, because they call the
> filter directly. A module, a test file and a changelog entry describing a fix
> nobody was running — the "written, documented, and never called" shape this
> repo has a name for, and it would have shipped the original defect a second
> time with paperwork.

There is a call-site census now, and it pins the filter's output to the name
`clusterByThickness` is handed, because calling it and discarding the answer is
the same defect wearing a call.

#### What this does not claim

It degrades the safe way: a bar whose numbers were drawn as line work rather
than text is not caught, and nothing found today stops being found. This only
ever removes a run, and only one wearing a ruler.
