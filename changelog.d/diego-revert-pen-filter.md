### The pen filter was deleting 59% of the walls (Diego)
`diego/revert-pen-filter`

#669 dropped every stroke at or below a sheet's commonest pen width, on the
reasoning that CAD draws walls heavy and hatching thin. It worked on the sheet it
was measured against: five slab joints running an apparatus bay disappeared, and
the wall count went UP, because thin strokes had been stealing partners from real
wall faces.

**The cost was never measured.** Four new plan sets arrived, and across 13 sheets
from them:

| | walls found |
| --- | --- |
| WITH the pen filter | **919** |
| WITHOUT it | **2,264** |

On one sheet it was **12 against 380**; on another, 59 against 425. It was
deleting most of a drawing to remove a handful of wrong lines.

## Why the premise fails

*"The commonest pen is the hatching pen"* is true of some exports and false of
others. On one sheet the mode landed **above** the pen the walls were drawn with,
so the filter kept the furniture and deleted the building — 1,623 long strokes
cut to 292, and the walls found halved.

Dropping only the THINNEST band instead was tried: better on one sheet (58 → 103)
and worse on another (386 → 349). **Neither rule wins on both**, which is the
signal that the idea needs a discriminator it does not have rather than a tuned
threshold.

## And the trade was the wrong way round

A missing wall is a **short bid** that nothing on screen reveals. A wrong line is
drawn on the drawing and gets rejected in a glance. For a tool whose whole safety
argument is that a person checks the output against the sheet, recall is the side
to err on.

Precision was never the complaint either: what was reported as *"reading the
wrong walls"* was the title block and the room numbers, and both are fixed by
`wallsInTheBuilding` and `wallsNotLettering`, which stay.

## What stays

`StrokeSegment.width` is still read and still carried through the graphics state,
with its `Q`-restores-the-pen test — because the measurement that produced these
numbers needs it, and because a future rule may use the pen as one signal among
several rather than as a gate.

The slab joints come back. They are five lines down a visibly empty bay on one
sheet, and they are drawn on the drawing.

## Verification

- The function and its 7 tests are deleted together, along with the viewer's
  wiring check — a guard for a call that no longer exists is worse than no guard.
- Four gates: **9,334 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open a floor plan with its scale set and press **Find the walls**.
   *Expected: MORE walls than before — roughly twice as many on most sheets.*
2. *Expected: still nothing on the title block, the notes column, the sheet
   border, dimension strings or room-number tags.*
3. *Expected: on a sheet with slab joints or floor patterns drawn at wall
   spacing, those come back. They are visible, and rejecting a group is one
   click.*
