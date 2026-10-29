# Doors and windows from the plan itself

Written 2026-10-29 with the branch that built it (`diego/doors-windows`).
Behind `Company.doorsWindowsOn`, OFF for every company.

## 1. What it reads

A door on a floor plan is a leaf line standing off the wall at the hinge and
a quarter-circle swing from the leaf's tip back to the strike in the wall.
The swing's radius IS the door's width. `openings.ts` finds a doorway as a
GAP in a wall face and measures the gap, which `openingMarks.ts` showed is a
fifth to a quarter narrower than the door; the leaf is the door.

Measured first: on the four training floor plans **not one door-sized
quarter arc arrives flagged `curved`** — every swing is exported as a run of
short straight pieces. So `doorWindowSymbols.ts` chains consecutive short
pieces turning the same way by a little, fits a circle (Kåsa), and keeps a
chain when it fits within 4% of its radius, the radius is 1.5–7 ft, the sweep
is 55–110°, and a straight piece runs from the centre to one end of the arc
(the leaf). The other end is the strike. Two leaves meeting at one strike are
one pair at the full width. MHK draws each office door three times over, so
the same hinge and strike is one door.

A window is frame, glass, frame: three or more parallel lines across a wall's
thickness, all stopping at the same two ends, in an EXTERIOR wall — one with
nothing within 60 ft on one side of it, by ray-cast from the run's midpoint.

## 2. The key, and what it is worth

`realplan/doorWindows.eval.ts` scores a sheet against a key under
`~/Claude Folder/takeoff/labels-doors/<set>/p<N>.json` (outside git). The
key is mostly the drawing's own lettering: every door mark drawn in a symbol
(or printed bare, outside a room-number box) is a door at that point, with
the width from the schedule read the second session cached
(`legend-cache/*-schedule.json`, Baker p26 and Bunkie p49). Unmarked doors
and every window were added by hand from crops, and the two sets without
usable marks were keyed on a REGION of the sheet from the crops.

| sheet | key | doors found / missed / false | width (schedule) | windows found / missed / false |
| --- | --- | --- | --- | --- |
| Baker A101 (p13) | 20 doors, whole plan; 0 windows | 20 / 0 / 0 | 18 of 18 within 1" | — / — / 32 |
| Bunkie A100 (p31) | 18 doors (7 marked + 11 existing), 4 windows | 18 / 0 / 0 | 7 of 7 within 1" | 4 / 0 / 23 |
| Crosslines A100 (p10), two-unit region | 30 doors, 8 windows | 30 / 0 / 0 | no schedule on the set | 4 / 4 / 4 |
| MHK A1.01 (p32), office block | 14 doors, 0 windows | 14 / 0 / 0 | no size strings readable without a model | — / — / 25 |

**Read the two right-hand columns differently.** Doors: 82 of 82, no false,
and every door with a schedule width agrees to the inch (worst 0.02 ft). But
on Crosslines and MHK the key's doors were placed FROM detections I confirmed
in the crops, and "missed" there means only that I saw no unlabelled swing in
the tiles — a weaker claim than Baker's and Bunkie's, whose keys come from the
marks and schedule independently of the detector. Baker's two misses on the
way (101, 100C) were real: 101 is drawn at a 65° swing (the floor was 70°),
and 100C's detection was being taken by door 102 four feet away under a
greedy key-order match; both fixed and both now found.

Windows are not shippable as a count and the panel says so ("to check").
Where a plan has exterior windows they are found (Bunkie 4 of 4, Crosslines 4
of 8), but on a plan with none the pattern still fires 25–32 times on the
exterior walls: a rated wall's hatch, a storefront's mullion lines, a desk
against the wall. Three rules were tried and measured on the way — inside
the found wall's band (misses Bunkie, whose windows sit in CMU piers a foot
outside the furring line the finder chose), in a gap of the run (kills
Bunkie too), exterior-only (what shipped). Crosslines' four misses are the
south wall of the 2nd–9th floor plan, which the ray-cast calls interior
because the 1st-floor plan is drawn 15 ft below it on the same sheet.

## 3. In the app

After Find the walls, with the switch on and not in labelling mode,
`TakeoffPlanViewer` runs `doorsAndWindowsForSheet` over the finder's own
strokes and walls and shows `TakeoffDoorsPanel`: count, pairs, each door's
width (the schedule's where a mark beside it matched a row, else the leaf's),
the group of the run it sits on, and the windows to check. The join is the
second session's `joinOpeningsToSchedule`, fed the doors as drawn openings
and the mark symbols from `tagSymbols`; the schedule rows are the newest
DOOR proposal per page (`PlanScheduleProposal`), loaded only when the switch
is on. Nothing is saved: this round counts and shows.

## 4. Not built

- Saving doors as takeoff items or deducting them from board — the
  deduction path (`openings.ts` + the join) is untouched.
- Overhead and coiling doors (MHK 119A–D): no swing, so no symbol to read.
- Office doors drawn as a slab in a frame with no swing (MHK 102–107 are
  drawn that way at this scale): not read, not in the key.
- Multi-plan sheets' inner exterior walls for windows (the ray-cast limit
  above); a per-view ray-cast using `planBoxes` would fix it.
- Door width from the drawing when the leaf is a thin rectangle rather than a
  line: handled by accident (one long side matches), not by design.
