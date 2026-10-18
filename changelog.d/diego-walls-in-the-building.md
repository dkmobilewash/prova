### It was reading the title block as a wall (Diego)
`diego/walls-in-the-building`

#666 shipped wall detection and the first person to use it reported it drawing
**the wrong walls**. They were right.

## The finder had no idea where the drawing was

It read the whole page. So it returned the title block's ruled lines, the notes
column, the sheet border, and the wall-section details printed above the plan —
every one a genuine pair of parallel lines at a genuine spacing, and none of
them a wall in this building.

## Why nobody caught it, which matters more than the fix

Phase 0 measured thicknesses on seven real sheets and found clusters at **4.88",
4.92", 4.80"** across three unrelated projects. #666's own changelog argued:
*"Noise does not land on 4-7/8"."*

**That reasoning is wrong.** A floor plan is full of parallel pairs at
building-ish spacings — fixtures, kennel runs, door swings, witness lines, hatch
boundaries — so some land on a partition thickness by arithmetic alone. Landing
on a plausible *thickness* says nothing about being in the position of a *wall*.

Phase 0 measured thicknesses and **never once checked positions**. It recorded
"no ground truth available" and then reasoned past it.

## What actually fixed it was being able to look

The missing instrument: render the sheet's own strokes in grey and the detected
runs in red, screenshot it with the Chromium already on the machine, and look.
The defect was obvious in one glance and so was the fix.

A floor plan is ONE connected thing; everything else on the sheet is somewhere
else. So the runs say where the plan is — join the ones near each other, keep
the biggest group by footage. Nothing knows what a title block looks like, which
is why it survives a differently-laid-out sheet.

**Both numbers in it were measured by looking, not chosen:**

| join distance | runs kept on a real sheet |
| --- | --- |
| 6 ft | **49 of 203** — the plan shattered into 46 pieces, keeping one corner |
| 12 ft | 132 |
| **20 ft** | **178** |
| 30 ft | 186 (plateau) |

The first attempt compared ENDPOINTS, which shattered the plan: walls meet in
**T**s far more often than in Ls — one wall's end against another's middle — so
it is point-to-segment now.

## What it does not fix, and the picture shows it

Noise INSIDE the footprint survives. On the sheet this was measured against,
that is five long lines down an apparatus bay — slab joints or a trench drain,
which genuinely are two parallel lines a wall-thickness apart. They are in the
building, so they join the building.

What saves an estimator there is the thing that saved this bug: the lines are
drawn **on the drawing**, the bay is visibly empty, and nothing is accepted
without a person looking.

## Verification

- 7 tests about POSITION — the question that was never being asked: a title
  block dropped, a plan whose runs meet in Ts kept whole, a doorway bridged, the
  biggest group taken by footage rather than count.
- **5 mutations, each red**, including *endpoint-only distance* (what shattered
  the plan) and *the viewer stops calling it* — that one was **GREEN** until a
  wiring check was added, the same gap `<FoundWalls/>` had.
- One test fixture was wrong and the suite caught it: 30 notes rules at 8ft each
  is 240ft, which really does beat a 210ft building, so the test asserted the
  opposite of what it claimed.
- Four gates: **9,319 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open a floor plan with its scale set and press **Find the walls**.
2. *Expected: no red lines on the title block, the notes column, the sheet
   border, or any detail drawn beside the plan. Before this they were all there.*
3. *Expected: the lines that remain sit on actual partitions.*
4. **Look before adding.** Anything inside the building that is not a wall — a
   slab joint, a trench drain — will still be offered, and the drawing is how
   you catch it.
