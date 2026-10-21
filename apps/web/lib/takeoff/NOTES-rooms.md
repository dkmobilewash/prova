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
