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

Re-run 2026-10-29 after rebasing on `main` with #824's finder (the found
wall counts moved: Baker 52 → 58, Bunkie 51 → 64, Crosslines 263 → 319, MHK
37 → 65): every door number above is unchanged — 82 of 82, no false, 25 of
25 widths within an inch. The windows moved; see §7.

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

## 5. Doors as room seals (2026-10-29) — built, measured, no effect on these sets

`roomsFromWalls` takes `doorSeals`: each detected door's leaf line, hinge to
strike, drawn as ink so the doorway closes where the door is with the door's
own width. `roomsFromWalls.test.ts` proves the input: a 14 ft opening, wider
than `openingsInWalls` will close, becomes two rooms with the seal.

`zzRoomDetect.eval.ts` with `ROOM_DOOR_SEALS=1` scores every arm twice, as
before and with the seals, on the same walls:

| arm | before | with door seals |
| --- | --- | --- |
| Baker A101, 36 accepted + traced walls | 8 regions, 6 tagged, 7 tags open, 2 merged; 6 measured, median 2.6% | identical |
| Baker A101, boundary set | 14 regions, 11 tagged, 4 open, 0 merged; 7 measured, median 2.0% | identical |
| Bunkie A100, 29 accepted + traced | 3 regions, 19 tags open; 1 measured | identical |
| Bunkie A100, boundary set | 7 regions, 6 tagged, 16 open; 6 measured, median 2.3% | 8 regions, otherwise identical |
| BIM, 18 sheets, the key's own walls | 640 joined, 411 measured, 2 open, 103 merged through a wall, 124 merged with no wall; median 1.1% | identical |
| Joplin A-101 p46, 1,761 raw pairings (no printed areas; closed / merged only) | 59 regions, 41 tagged, 4 tags open, 32 merged; 40 keyed rooms closed | 61 regions, 45 tagged, 4 open, 28 merged; **44 closed** (+53 seals) |
| Joplin p47, 1,050 raw pairings | 36 regions, 29 tagged, 56 open, 2 merged; 29 closed | 41 regions, 30 tagged, 36 open, **21 merged**; 29 closed (+52 seals) |

**On the three sets with area keys the seals change nothing, because the
doorways were already closed.** The finder's face lines stop at a door and
`openingsInWalls` seals that gap; the leaf closes the same gap again. Joplin
is the one sheet where they do something, in both directions: p46 closes
four more keyed rooms and merges four fewer; p47 turns twenty open tags into
nineteen MERGED ones — the seals close the corridor side of rooms whose
party walls the raw pairings never drew, so the closed region holds several
tags. A merged room is at least a region an estimator can see and split; an
open one is nothing. Neither sheet prints areas, so the error column is
empty there. What keeps rooms open on Baker and Bunkie
is the WALL SET (§4 and §8 of NOTES-rooms.md said so on 2026-10-22, and this
is the same answer from the other side), and what merges BIM rooms is a
wall the model does not have. So the door seal is in the engine and inert
on every sheet measured; it would earn its place on a sheet whose doorways
the gap rule cannot close — a 12 ft+ opening, a door at a corner with wall
on one side only — and none of these four has one that a key room sits
behind.

## 6. Door widths into the run's openings (2026-10-29)

With the switch on, the viewer reads the doors BEFORE grouping and gives
each run the detected doors' widths as its `openings`, in place of the gap
widths `mergeWalls` inferred (the leaf is the door; the gap is a fifth
narrow). The "includes N openings, not deducted" note on a group now counts
doors. On save, a detected door the join named — so its schedule row has a
height — rides along as an opening width and height the way the plan-text
doors do, skipping marks the plan-text read already placed.

## 7. Window precision, second attempt (2026-10-29) — not reached, kept as "to check"

Two rules added to §1's exterior-wall gate: a window's frame lines must
not be covered by a straight stroke at the same offset running on a foot or
more beyond both ends (a hatch, a desk, a continuous face), and a window
tag beside the candidate was tried as an override. Measured:

| plan | before | after |
| --- | --- | --- |
| Baker A101 (no windows) | 32 false | 33 false |
| Bunkie A100 (4 windows) | 4 found, 23 false | 0 found, 4 false |
| Crosslines A100 region (8) | 4 found, 4 missed, 4 false | 4 found, 4 missed, 2 false |

Crosslines improved; Baker did not; Bunkie got worse for a reason that is
not the rule: `main` now carries #824's finder, which pairs the dashed
canopy line 4 ft east of Bunkie's east wall as a 63 ft wall, and the
ray-cast then calls the east wall interior. The tag override cannot save it,
(CORRECTED 2026-10-31: this said Baker's `W1`–`W7` are wall types. They are not. A611 "WINDOW/DOOR TYPES AND SCHEDULES" lists `W1`–`W6` as window types, Baker's wall types are the `S8B`-style tags, and the plan has 9 tagged windows, so the `0 windows` key above is wrong.) What Baker's 33 are, from the crops: a
wall-mounted projection screen drawn as a thin rectangle along the west
wall (four of them, 5.1 ft each), exterior-wall stretches drawn as three
lines where the finder made no run, and interior walls the ray-cast calls
exterior because the existing building beyond them has no found walls.

So the 80% precision target is not met on Baker (0 of 33) or Bunkie, and
the panel keeps saying "to check". The face-coverage rule stays (it is the
one that helped and it costs nothing). What would move it: an exterior test
that reads the drawing rather than the found walls — which side of the wall
has rooms — and a window SCHEDULE join, which gives widths to check against
the way the door schedule does; neither is in this round.

## 8. The schedule join counts, and a window needs a symbol (2026-10-29, `diego/pilot-schedule`)

Two counts the pilot flagged: SW Grand Junction's A110 read 3 doors of 5
scheduled, and Joplin's A-101 54 windows where an estimator counts about
36. Measured with the cached schedule reads standing in for the ingest's
DOOR proposal (`DW_SCHEDULE_CACHE`; the eval now runs
`doorsAndWindowsForSheet` itself, so it scores what the viewer shows).

### Doors: what the schedule knows that the swing does not

`joinOpeningsToSchedule` already placed a scheduled mark with no swing on
the nearest run (§3 of `openingMarks.ts`). Three things stopped it counting:

- **The pilot fed it no rows.** The viewer passes the newest DOOR proposal;
  the pilot harness passed `[]`. Now it passes the cached read, and the
  headline count is `doorCount()` — drawn doors plus those placed from a
  tag — in the panel and the harness alike. The panel lists the placed ones
  ("placed from its tag, no swing drawn") and the schedule rows no door on
  the sheet carries.
- **SW's 10 ft sliding door 101 sits in a storefront, not a wall.** The
  finder's runs are the brick piers 5 ft either side; the tag under the
  door's middle was 5.1 ft from both, past the 4.5 ft symbol reach and
  clearly nearest to neither. A symbol mark past the END of two collinear
  runs, each within half the scheduled width of it, is now the door between
  them, centred where the mark projects onto their line.
- **Bunkie prints its marks in pills the symbol pass does not draw.** E101
  and E102 were drawn, found and unnamed. A text item that IS a schedule
  mark, inside no symbol already read, is a mark too (loose, so it gets the
  2.5 ft reach, not the symbol's 4.5).

| sheet | keyed | drawn | named by a mark | placed from a tag | schedule rows | rows not on this sheet |
| --- | --- | --- | --- | --- | --- | --- |
| SW A110 (p5, keyed this round from the sheet) | 5 | 3 | 3 | **2** (101 sliding 10 ft, 102B overhead 8 ft) | 5 | 0 |
| Baker A101 (p13) | 20 | 20 | 18 | 0 | 18 | 0 |
| Bunkie A100 (p31) | 18 | 18 | 5 → **7** | 0 | 11 | 4 (K106–K108D: the warehouse building, another sheet) |
| MHK A1.01 (p32, office region) | 14 | 14 | 1 → 2 | 4 outside the region (119A–D, the warehouse's overhead doors, from their pills) | 31 | 25 (marks are not in the text layer) |
| Crosslines (p10, region) | 30 | 30 | — | — | no schedule | — |

Found / missed / false on every keyed sheet is unchanged at 0 missed, 0
false; SW is 5 of 5 where it was 3. The "rows not on this sheet" column
is honest about a schedule that spans a set: Bunkie's K-rows belong to
the warehouse plan, and the number is per SHEET, so a set-level total
has to subtract rows placed on any sheet. MHK's 25 are doors that are
drawn and found but cannot be named — the sheet's marks are outlines, not
text — which is a naming gap, not a counting one.

Not built: a WINDOW schedule join. No training set has a window schedule
read (the legend cache holds DOOR schedules only), so there is nothing to
measure it against; the window side below is symbols and tags.

### Windows: the symbol, not the band

By eye over Joplin's 54 (crops in `shots/pilot/doors/joplin-win/`): the
13–15 ft ones were the exterior wall's two faces plus a parallel roof,
sill or rated-wall line, pier to pier — never a line INSIDE the wall. And
the resident-room wall's 6 ft 5 in cavity-wall pieces between the 4 ft G
windows were kept because the G tag over the window was within 6 ft of
them too, then merged with the windows either side into 14 ft "windows".
Three rules in `windowSymbols`, measured one at a time:

1. **Glass inside the wall.** Without a tag, a candidate needs one line
   strictly inside the matched wall's thickness and none more than an inch
   outside its faces. The faces-and-roof pattern has no inside line; a
   band drawn beside the wall has none either.
2. **A tag names the nearest candidate only** — not everything within 6 ft.
3. **…and the lites drawn like it**: a candidate on the same wall, collinear,
   within a mullion, with the same lines across it, is a pane of the same
   storefront (Joplin's D and Q glass partitions, three and four lites with
   one tag). The cavity wall between two G windows is drawn with different
   lines, so it is not.

The product now passes window tags (`doorsAndWindowsForSheet`), which the
eval always had; "before" below is with tags on both sides.

| sheet | key | before: found / missed / false | after |
| --- | --- | --- | --- |
| Baker A101 (no windows) | 0 | — / — / 26 | — / — / **13** |
| Bunkie A100 | 4 | 0 / 4 / 4 | 0 / 4 / 4 (east wall still called interior, §7) |
| Crosslines region | 8 | 4 / 4 / 2 | 4 / 4 / **0** |
| MHK office block (no windows) | 0 | — / — / 8 | — / — / **3** |
| SW A110 (not keyed for windows) | — | 22 | 5 (W1/W2 storefront lites) |
| Joplin A-101 (eval, finder walls) | by eye | 70 | 44 |

Joplin's 44, by crop: the G windows read one by one at 3.7 ft (twelve),
the C windows at 2.7 ft (three), the D and Q partitions at their full
width, the vestibule storefronts, F at 10 of its 13 ft. Still false among
the ones looked at: a hatched rated wall (12.9 ft), two pieces of cavity
wall drawn with inner lines (8.9 and 5.3 ft) — a cavity wall's layer lines
are inside the wall too, and nothing in the geometry tells them from
glass. The pilot's number moved 54 → 44 on the stored proposal walls.

## Doors with no mark (2026-10-31)

Where at least 75% of a sheet's doors have a mark within 3 ft, a door with none is dropped. Baker A101: 18 doors within 2 ft of a tag and the other two at 6.6 and 10.3 ft, in the (E) rooms, so 20 becomes 18, which is the number of tags on the sheet. Joplin A-101 is at 23%, because its door marks are not symbols `tagSymbols` reads, so all 53 stay. Bunkie's pills were not measured for this; the share gate is what protects it.
