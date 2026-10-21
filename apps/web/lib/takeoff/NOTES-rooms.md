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

## 5. Rooms from a BOUNDARY set (queue 1, rewritten, 2026-10-21 evening)

Boundary = the finder's raw pairings (every `onCandidate`, pre-triage) at
least 2 ft long — 90% of the raw set on Bunkie A100 is 0.67-ft hatch pairs
that fill the existing building with ink and bound nothing — plus every
candidate the reviewer was offered, any verdict, plus the traces. A tag's
own drawn box pairs as a short wall and put the tag in a region too small to
be a room, so the finder's `wallsNotLettering` runs on the boundary first
(that one filter took Bunkie from 2 rooms back to 4).

| sheet | accepted+traced | ALL offered | BOUNDARY |
| --- | --- | --- | --- |
| Bunkie A100 (6 keyed) | 0 measured | 4, 3 within 10% | **4, all within 5%, median 1.7%**; #1 + corridor open (corner door) |
| Baker A101 (9 keyed) | 6 within 4% | 4 | **7 within 10%, median 2.0%, no merges**; 911 + vestibule open (existing walls) |
| SW A110 (7 keyed) | 1 | 1 | 1 (office 105); sales floors have no walls, restroom/alcove/hallway corner doors |
| Bunkie A104 (2 keyed) | 0 | 0 | 1, wrong by 74% — enlarged plan, sparse candidates |
| BIM, 713 keyed | — | — | end to end through the finder, no key walls: **206 measured (median 2.4%, 140 within 5%), 264 open, 212 merged** — against 477 from the key's own walls |

So the boundary set is the right input and the room step holds up on it; the
remaining misses are walls the finder never proposes (existing poché, CMU
hatch bands, corner doors) — the finder lane's territory, which is what
queue item 2's hints are for. Overlays: `shots/rooms/boundary__*`.

## 6. The customer view (queue 3) — plan, no code, no migration run

**What the estimator sees.** On a calibrated floor-plan sheet, a **Find the
rooms** button beside *Find the walls*, enabled once that sheet has found
walls (the boundary set comes from the same pass). It produces a **Rooms**
panel: one row per room — name, number, square feet, perimeter feet, and a
status (*named* / *unnamed* / *open: not enclosed* / *shares a region with
N*). Clicking a row highlights the polygon on the sheet; hovering the sheet
highlights the row. Totals at the foot: rooms, square feet, perimeter —
the ceiling, flooring and paint quantities the panel exists for.

**Editing.** A room is an AREA measurement, so the existing area tools
apply unchanged: drag a corner, add a cutout (a column, a stair core),
delete. Two room-specific edits: *rename / renumber* (the tag reader was
wrong or the tag is missing) and *draw the missing wall* — a one-line trace
that re-runs the room step for the rooms it touches, which is the
estimator's version of queue item 2's hint. The hints themselves show as a
dashed line with "wall missing here? N ft" on open rooms, and clicking one
turns it into a trace.

**Posting.** Rooms post like any area measurement, to a takeoff item (ACT,
flooring, paint) with the same `postTakeoffMeasurements`; perimeter posts
as LINEAR to a base/trim item. Nothing new in the posting path.

**Data: reuse `TakeoffMeasurement` (`kind: AREA`), not a new table.** A
room IS an area with a polygon, a label, a calibration, cutouts, a source
and a confidence — every column already exists. What is missing is the
structured part of the tag, so the finish-schedule join and the panel's
sort can use it, and a source value that says a machine drew it:

```prisma
enum TakeoffMeasurementSource {
  MANUAL
  DETECTED
  IMPORTED
  ROOM_FINDER   // + : drawn by roomsFromWalls, polygon editable like any area
}

model TakeoffMeasurement {
  …
  /// From the room tag inside the polygon, when there is one. Free `label`
  /// stays what the estimator typed; these are what the drawing printed.
  roomName   String?
  roomNumber String?
  @@index([pageId, roomNumber])
}
```

Migration: one `ALTER TYPE … ADD VALUE 'ROOM_FINDER'`, two nullable
columns, one index — additive, no backfill, nothing reads it until the
panel ships. Perimeter is NOT stored: derived state (it is the polygon's
own length at the sheet's calibration), per the derived-state rule. "Open"
and "merged" are not stored either — an open room is not saved as a
measurement at all, it is shown as a hint until the estimator closes it.

**Proposed, not run.** The second session's library migration is also
pending; this one should go in the same window and be announced in
`#prova-build` before the push, per the working agreement.

**Order of work once approved:** (1) migration + `saveTakeoffMeasurements`
accepting `ROOM_FINDER` rows with name/number; (2) `roomsFromWalls` wired
to the viewer's found-walls result with the boundary set; (3) the Rooms
panel and row ↔ polygon highlight; (4) hints as dashed lines; (5) e2e step
on the synthetic sheets (S05 has nine keyed rooms, areas to 1 sf), and a
click-list for Cyrus on Baker A101 — seven rooms, expected square feet
printed above.

## 7. Built (queue 2, night of 2026-10-21) — on the branch, not merged, switch OFF

| piece | file |
| --- | --- |
| per-company switch, off by default | `Company.roomFinderOn`; `RoomFinderSwitch.tsx` on Settings (owner saves, everyone sees); `saveRoomFinderSwitch` |
| the button | `TakeoffPlanViewer.tsx`: "Find the rooms" beside Find the walls, rendered only with the switch on, enabled after a find on this sheet |
| the boundary | `roomBoundary.ts`: every pairing ≥ 2 ft from the last find + the kept runs + the sheet's hand-drawn LINEAR measurements |
| the rooms | `roomsFromWalls.ts`, run in the browser, no PDF re-read; polygons on the overlay (green named, amber unnamed) |
| the panel | `TakeoffRoomsPanel.tsx`: name / number (editable) / sq ft / perimeter; not-enclosed and share-one-room lists; Save as areas |
| the save | `saveRoomMeasurements`: one transaction of AREA rows, `source: ROOM_FINDER`, `roomName`/`roomNumber`, label = the edited tag |
| migration | `20261022000000_rooms_from_walls`, applied + read back on a throwaway Postgres only |
| draw the missing wall | no new tool: draw a Line where the wall is missing, Find the rooms again (the boundary includes LINEAR measurements) |
| tests | `roomsFromWalls`, `roomTags`, `roomBoundary`, `takeoffRoomFinder.test.tsx` (off → absent; on → present, waiting), `e2e/specs/takeoff-rooms.spec.ts` on S05, `takeoff-rooms-real.spec.ts` for screenshots from a real sheet, gated on env |

Not built, on purpose: leak hints as dashed lines (the probe is seconds per
tag; it belongs on the server or in a worker, not on a click), the
finish-schedule join, and room types. The "draw the missing wall" edit is
the Line tool plus a re-run rather than a mode of its own — one less thing
to learn, and the line is a measurement the estimator can keep.

### Seen running, not only tested

- `e2e/specs/takeoff-rooms.spec.ts` on S05, port 3110, throwaway Postgres:
  switch off → no button; owner turns it on; walls then rooms → **7 rooms,
  866 sf, all seven named from their tags** (the garage stays open: its
  16-ft overhead door is wider than anything the seal calls a door); rename,
  save → 7 Unassigned measurements after a reload. Screenshots in
  `apps/web/e2e/artifacts/rooms/` (gitignored).
- `takeoff-rooms-real.spec.ts` on **Baker A101** (page 13 of the set,
  pulled out with pdf-lib into `~/Claude Folder/takeoff/shots/rooms-app/`,
  never under the tree), port 3120: Find the walls, Find the rooms →
  **7 rows, 6 named**; 254, 126, 190, 162, 432, 439, 70 sf against the code
  plan's 127 (ham radio), 191 (storage), 165 (IDF), 440 (911), 468
  (conference) — so four of the six named rooms are within 5% in the live
  app, and the two large open spaces (main operations 1,337 sf, the existing
  wing) are not closed by the app's own candidate set, which is thinner than
  the eval's boundary set. Shots `p13-01-walls.png`, `p13-02-rooms.png`.
- Three things the e2e caught that no unit test could: the first switch
  form submitted natively when pressed before hydration (now an
  `ActionForm`); the settings switch lives on the Estimating tab; the real
  sheet needs its pixels before Find the walls means anything.
