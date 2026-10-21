# Rooms & areas — the third lane's notes

Started 2026-10-21 on `diego/rooms-areas` (off `diego/takeoff-audit` 2e116a68).
Owns: room detection, room areas/perimeters, room names/numbers, the
finish-schedule link, and their evals. Does not touch the finder files, the
classifier, the labeling UI, the label files, either server, the DB or
migrations.

## 1. What exists (surveyed 2026-10-21)

| piece | where | state |
| --- | --- | --- |
| Region finder (occupancy grid, flood fill, `neighboursOf`, wall-between-rooms) | `rooms.ts` | engine, tested, no caller in the app |
| Rooms inside a box → polygons + sq ft (`roomsInBox`, `traceRing`, `ringCorners`) | `roomAreas.ts` | engine, tested, **deliberately disabled** — `takeoffRoomFinder.test.tsx` asserts there is no button |
| Door-gap sealing (`openingsInWalls`) | `openings.ts` | engine; used only by `roomAreas.ts` / `wallRuns.ts` |
| Room name/number/printed-area reader (`roomsFromWords`) | `fixtures/expected.ts` | reads WORDS in order, no positions; used only to build the synthetic fixture key |
| Finish-schedule reading | `plan-ingest/scheduleTable.ts` (rows from geometry) + `integrations/scheduleRows.ts` (model names the columns, `kind: FINISH` exists) | ingest path only; nothing links a finish row to a room on a plan |
| Room classification | — | nothing |

Why `roomAreas` is off, in its own words: it rasterises EVERY stroke, so a
leader cuts a room in two, a dimension string encloses a region of its own,
a car or a keynote tag is a "room", and the biggest rooms (the most crossed)
vanish. West Herr: 46 rooms / 4,555 sf for a 290-ft building. The ring
geometry is right; what reaches it is wrong.

The queue's framing fixes exactly that: build the grid from the **found
walls** (accepted + traced verdicts in the label files, which the reviewer
has already cleaned of leaders, dimensions and furniture) plus door-gap
seals, instead of from every stroke on the page.

## 2. Answer keys without new labelling

Measured 2026-10-21 (`realplan/zzRoomAreaInventory.eval.ts`; held-out sets
never opened). Real training sets mostly print areas on CODE plans and area
tallies, not on the floor plan — but three sets give usable per-room keys:

| set | page | what | rooms with name + SF |
| --- | --- | --- | --- |
| Baker EOC | p4 (code/area plan of the same building as A100/A101) | tag = NAME over SF, no number | 13 |
| Bunkie | p31 (A100, a labelled sheet) and p32 | NAME / NUMBER / SF tags | 4 on p31, 6 on p32 |
| SW Grand Junction | p43 | NAME / NUMBER / SF tags | 7 |

Not rooms, recorded so nobody re-checks: Baker p15 (solar-ready roof
areas), SW p20 (a structural load table), Crosslines p4 and the MHK/NG/
Murray p2–p5 pages (building-area summaries), Bunkie p46 (finish-schedule
page repeating two toilets' areas).

BIM sheets (`~/Claude Folder/takeoff/bim-sheets`): 36 sheets, **1,586
rooms**, every one with number, name and `area_sf` from the IFC spaces. The
`r1-section` renderer also prints a room tag (NAME / NUMBER / `n SF`) with
its position for a subset — 6 + 4 + 23×4 + 22 + 6 + 22×2 + 18 + 17 + 37 +
30 + 10 + 20 + 79 + 67 ≈ 430 positioned rooms. `r2-ifcsvg` prints no tags,
so those 18 sheets are usable only through name matching, not position.
The key carries no room POLYGON, so matching is tag-position → detected
region, and the score is area error.

Synthetic S01–S20 (`fixtures/truth/*.json`): `rooms[].area_sf`,
`perimeter_lf`, `centroid_ft`. Our own generator, so a floor, not a result.

## 3. Plan

1. **Keys** (queue item 2): one eval writes
   `~/Claude Folder/takeoff/answer-keys/rooms/<set>/<sheet>.json` —
   `{ rooms: [{ name, number, areaSf, at: { x, y } }] }` in page-width
   units, from (a) printed tags on the three real pages above, (b) BIM keys
   joined to their tag text positions, (c) synthetic truth. No labelling.
2. **Detection** (item 3): `roomsFromWalls(walls, doors, text, sheet)` —
   grid from accepted/traced wall segments (thickened to their own
   thickness) + `openingsInWalls` seals; `regionsOf`; keep closed regions
   above `SMALLEST_ROOM_SQFT` and wider than `WIDEST_WALL_INCHES`; polygon
   via the existing `traceRing`/`ringCorners`; area and perimeter per room;
   name/number from the tag whose position falls inside the region (new
   positioned reader, `roomsFromWords`'s patterns reused).
3. **Measure**: per room, |detected − key| / key, on BIM r1 tagged rooms,
   the 26 real-plan rooms, and the synthetic set. Report distribution and
   the misses (rooms with a tag and no region, regions with no tag).
4. **Report with crops** (item 4) — STOP for Diego.

Open question for later, not now: a finish-schedule row → room link needs
the schedule's room numbers and the plan's; both readers exist, the join is
new, and it is worth nothing until rooms are found.

## 4. What was built and what it measures (2026-10-21, c50f9bc1..HEAD)

`roomTags.ts` reads NAME / NUMBER / AREA stacks by position (test pinned:
tally columns, partition codes above the name, `#1` names, `1E15-A` and
`01.1.1` numbers, `ELUTUBA+KÖÖK`). `roomsFromWalls.ts` draws each found wall
as a band of its own thickness, seals door-sized gaps between collinear walls
(`openingsInWalls`, fed the walls' two faces because it was written for
faces), floods the enclosed regions, traces each into a polygon, and names a
region by the one tag inside it. Two tags in one region = `mergedTags`; a
tag in no closed region = `unplacedTags`. `realplan/zzRoomDetect.eval.ts`
scores area per room against the keys; `realplan/roomCrops.swift` renders
the page with rooms, walls and tags (green = named, orange = unnamed, blue
dot = placed tag, magenta = merged, black X = open). Crops in
`~/Claude Folder/takeoff/shots/rooms/`, numbers in
`coordination/rooms-measure.txt`.

### The room step itself is accurate

BIM arm — the key's own wall centrelines, 18 r1-section sheets, 713 tagged
rooms: **477 measured, median area error 1.2%, 438 within 5%, 455 within
10%**. kit-office and smiley-west KG: every room, all within 5%. So polygon
→ square feet is not where the error is.

The rooms it does not measure, by cause:

| cause | rooms | what it is |
| --- | --- | --- |
| merged, NO wall between the two tags in the model | 130 | one physical space the model splits with a virtual boundary (clinic waiting/reception/corridor, esplanades living/kitchen). No wall-based detector can separate these. |
| merged THROUGH a wall | 102 | mostly the esplanades entry halls (X-2) opening into the living room (X-1) around a corner with no door — a cased opening, not a door-sized gap on one line. See `shots/rooms/bim__esplanades__2korrus__r1-section/*merged-24-2.png`. |
| open | 4 | after curtain walls were added as boundaries (was 20: the clinic's waiting area is bounded by storefront) |

Signed errors run slightly negative (−0.7% to −2%): measured to the inside
face, the key's IfcSpace is marginally larger. Smiley-west EG's living rooms
read 327 sf against a 383 sf key on every flat — the model's space includes
a strip the drawn walls separate (`…smiley-west__eg…flat-01.png`); key vs
drawing, not a detector miss, and left as is.

### On the real sheets the limit is the WALL SET, and it is a scope question

| sheet | walls | regions | key rooms measured |
| --- | --- | --- | --- |
| Baker A101 | 36 accepted+traced | 8 | **6 of 9 joined, all within 4%** (127→132, 191→196, 165→171, 1337→1341, 96→97, 468→475); 3 open |
| Bunkie A100 | 29 accepted+traced | 2 | 0 of 6 — every room open |
| Bunkie A100 | ALL 78 candidates incl. rejected | 13 | 4 of 6 measured, 3 within 10%; E100 + corridor merged (door in the corner) |
| SW A110 | 21 accepted+traced | 2 | 0 of 7 |
| SW A110 | ALL 100 candidates | 16 | 0 of 7 |
| Baker A100 | 77 | 27 | no room tags on the sheet (demolition/existing plan) |

The crops say why, and it is the same thing on all three: **the reviewer's
accepted walls are the SUB's walls**. Existing walls (shaded), the CMU
corridor wall on Bunkie, the brick and storefront on SW are rejected or
never offered — correctly, for a drywall bid — and a room is bounded by
every wall there is. Bunkie's four interview rooms close as soon as the
rejected candidates are added back; SW's sales floors 101/102/103 have no
wall between them at all (dashed floor lines), so their printed areas are
unreachable from walls on any input, like the BIM "no wall" rows.

So room detection needs a DIFFERENT input from the wall takeoff: every
wall-like boundary on the sheet regardless of trade — new, existing, CMU,
storefront — which the finder's candidate list has more of than the
accepted set does. That is a product decision, not a threshold.

### Tried and measured OFF: sealing corner-hinged doors

Bunkie E100, SW restroom 104 and alcove 107 leak through a door hinged
against a perpendicular wall (wall on one side of the gap only). A seal for
that shape was written (`cornerSeals`): at 12 ft it closes the BIM leaks
by cutting open-plan rooms to pieces (median 1.2% → 6.9%, 438 → 329 within
5%); at 4.5 ft it closes nothing on the real sheets and still costs 48 rooms.
Kept exported, off by default, numbers in its header.

### Next, in order of value

1. Decide the input: rooms from ALL candidates (plus existing walls) rather
   than from accepted walls. Re-measure Bunkie and SW on that.
2. Finish schedule → room link: both readers exist, the join by room number
   is small, and it is worth something only once rooms are found on the
   real sheets.
3. Rooms on BIM sheets through the FINDER (end-to-end) rather than the key's
   walls — the finder lane's candidates on those 36 sheets.
