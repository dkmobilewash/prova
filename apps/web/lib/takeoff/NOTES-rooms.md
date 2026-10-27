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

## 8. The 2026-10-22 training sets (queue 1, rewritten)

**What they print.** Of the five, only Camp Clark's code plan (G-101, p3)
prints room areas — inside each room, no name over them, so the key is
12 areas by POSITION. Joplin A-101/p47, Topeka G-100b and the Supreme Court
library print NAME / NUMBER tags and no areas; their keys say which rooms
exist and where (74, 78, 73, 7 rooms) and nothing about size. The Fairgrounds
comfort station prints no room tags at all. Topeka's "S.F." figures are unit
schedules and unit-plan titles, not rooms.

**Scale without a calibration.** Dimensions first (`readSheetScale`), the one
printed scale on the page second (`scaleFromPrinted`) — never hand-set. Joplin
A-101 read 1/8" from its dimensions; Camp Clark, Joplin p47 and Topeka have
their dimensions as line work and read their printed scale; Topeka's
dimensions agree on 1/32" but no line fits within 1%, and the printed scale
says 1/16" — the dimensions belong to the enlarged plans, not these.

**Rooms from raw pairings alone (no reviewer, no traces):**

| page | scale | raw pairings ≥ 2 ft | closed / keyed | area error |
| --- | --- | --- | --- | --- |
| Camp Clark G-101 p3 | 1/8" printed | 878 | 10 / 12 | median 6.1%, 5 within 5%; showers at half (partitions split them) |
| Joplin A-101 p46 | 1/8" dims | 1,184 | 6 / 74 | no printed areas |
| Joplin p47 | 1/8" printed | 940 | 11 / 78 | no printed areas |
| Topeka G-100b p6 | 1/16" printed | 3,693 | 0 / 73 | no printed areas; 26 regions, none tagged |
| Supreme Court p6 | 1/8" printed | 39,474 | 0 / 7 | hatched existing plan, no region closes |

So on a sheet nobody has reviewed, the finder's pairings close a tenth of
the rooms. The room step is not the limit (Camp Clark's big rooms are right);
the pairing set is — the corridor-side walls with a door and a sidelight,
and anything at 1/16". Hints for 38 rooms are in
`coordination/rooms-missed-walls.md`, part 2. Overlays in
`shots/rooms/boundary__*__p*/`.

## 9. Hatched walls, stall partitions, small scale (2026-10-22 pm)

Rooms files only; finder output consumed through `detectForSheet` +
`offeredCandidates(…, hatchPitchRule: true)` after merging the original
session's branch in. Training sets only.

**1. Hatched walls as boundaries.** The offered single lines under the
even-pitch rule include the walls drawn as a fill between two faces — and,
measured on Joplin A-101 the first time, the column grid and the dimension
strings too (194 "rooms" for 74). Kept only the singles that start and end
inside the paired walls' extent plus 3 ft. Before / after, rooms closed of
keyed (tags-only keys, so closed is the measure):

| sheet | raw pairings only | + hatched singles inside the building |
| --- | --- | --- |
| Supreme Court library p6 | 0 regions, 0 / 7 | 6 regions, 1 / 7 (41 singles) |
| Joplin A-101 p46 | 6 / 74, 66 open, 4 merged | 19 / 74, 2 open, **54 merged** (104 singles) |
| Joplin p47 | 11 / 78 | 11 / 78 (39 singles) |
| Camp Clark G-101 | 10 / 12, median 6.1% | 9 / 12, median 5.0% (28 singles) |

So the hatched singles turn Joplin's open rooms into merged ones: the
resident-room walls now reach the corridor wall, and the door-plus-sidelight
openings on the corridor side merge each room with the hall. The Supreme
Court library gains one closed room; its plans are existing poché with glass
stacks, and six of seven rooms stay open. Not a default; an input the finder
lane can decide to offer.

**2. Toilet partitions.** `notStallPartition` drops a paired run thinner than
1.8 in and shorter than 7 ft, in feet. On the BIM arm that is +16 rooms within
5% (438 → 454) for 2 rooms newly merged, labels arm unchanged — kept. **It does
not touch Camp Clark**, and the crop says why: the dividers inside its 375 sf
"shower" areas are 6.4-ft runs at 3.7–7.2 in, framed shower-stall walls
drawn as walls. The code plan's 375 sf is the SUITE (stalls, toilet, H.B.);
the method measures the walled rooms inside it, 93–185 sf each. That is the
key disagreeing with the drawing, not a leak, and nothing here should split
the difference.

**3. Topeka at small scale.** The code plans are captioned 1/16" and their
45 printed dimensions agree on 1/32": half-size reproductions of the floor
plans. `readSheetScale` declines at 0.9% against its 0.5% rule, so the
product shows no scale; measured here at the dimensions' 1/32" and labelled
as such. Result 0 / 73 either way, before and after hatched singles (132
regions, 58 open, 22 merged): the unit partitions on these diagrams are
single grey lines the pairer never pairs and the hatch rule never offers.
Every threshold in the room step is already in feet (`RAW_MIN_FEET`,
`SMALLEST_ROOM_SQFT`, the door seals, the stall bounds); the one unit-based
limit is the grid cap, 0.28 ft per cell at 1/32", which is not what fails
here. The unit plans p78–80 (3/32" and 1/4") are the sheets rooms are drawn
on, and they print no areas.

## 10. What rooms needs from the finder — ranked, for the original session

Every item below is a boundary the room step cannot invent and the finder's
candidate list does not carry. Ranked by rooms recovered per unit of finder
work, measured on the training sets (NOTES §5, §8, §9), with the sheet that
shows it. "Rooms" here means tagged rooms that would close; the room step
itself is measured at 1.2% median area error once a room closes (§4).

1. **Single-line partitions as candidates.** Topeka G-100b (73 rooms, 0
   closed): every unit partition is one grey line, never paired, never
   offered. Joplin's resident rooms and Camp Clark's interiors carry the same
   thing in places. A single line that joins two paired walls end to end is a
   wall for room purposes — offer it as a candidate with the default
   thickness, and let the reviewer judge it. This is the biggest gap and the
   only one that touches whole sheets.
2. **The door jamb stubs.** Joplin A-101: the corridor-side pieces beside each
   door are 4-inch pairs, under every length floor, so the corridor wall of
   every resident room is absent from the list and the room merges into the
   hall (54 of 74 merged with hatched walls in). A pair shorter than 2 ft that
   sits collinear between two openings is a jamb, and the room step can seal
   from it; today it is dropped before anybody sees it.
3. **Existing walls as boundaries, flagged.** Bunkie A100 (6 rooms, 0 closed
   from accepted walls, 4 within 5% with every candidate back in), Baker A101's
   vestibule, the Supreme Court library (hatched poché, 1 of 7). The reviewer
   rejects them correctly for the bid; rooms need them anyway. A candidate that
   survives the finder but is rejected for SCOPE rather than for not being a
   wall should keep a mark the room step can read, instead of vanishing with
   the junk. `offerAll` is close to this and is not it.
4. **Hatched walls under the even-pitch rule, inside the building.** §9: the
   offered singles under `hatchPitchRule` close rooms the pairer cannot
   (Joplin 6 → 19) and pull the column grid in unless clipped to the paired
   walls' extent. Worth offering as a class the room step can take on its own,
   not as part of "unclassified".
5. **Storefront and curtain wall as a boundary class.** BIM clinic: 20 rooms
   open until the key's curtain walls were added (§4). The finder sees
   storefront as glazing lines; rooms need it as a wall of zero thickness.
6. **Scale when dimensions decline but agree.** Topeka: 45 dimensions agree on
   1/32", the product declines at 0.9% against 0.5%, the caption says 1/16".
   Not a rooms rule, but every page it happens on is unmeasurable for rooms,
   and the agreed scale was right. Same lane as the queue's printed-scale item.

Not asked for, and said so: corner-door sealing as a default (§4, measured
off), splitting suites the code plan sums (Camp Clark's showers, §9), and
anything about rooms the drawing does not wall (SW's sales floors, the BIM
"no wall" merges).

## 11. Door + sidelight openings (2026-10-22 eve) — built, measured, OFF by default

The shape, from the Joplin crops (`shots/rooms/joplin-doors/`): each resident
room's corridor side is a door hinged in one corner plus a glazed sidelight
to the other partition. No collinear wall on either side of the gap, so the
door rule has nothing to anchor on; the jamb stubs are 4-inch pairs the
boundary never carries. But the sidelight's glazing lines are drawn, jamb to
corner. `bridgingLines` (`roomsFromWalls.ts`, option `bridgeSidelights`):

  1. a stroke ≥ 2 ft with one end at a wall END, continuing that wall's line
     within 10°, not lying along a wall it duplicates — the glazing;
  2. from its free end, along its own line, a probe up to one door's width
     (4.5 ft) to the first wall — the door hinged in the corner;
  3. kept only when the probe completes the pattern, or both ends sit at wall
     ends.

Three versions, because the BIM arm is the control and each earlier one
failed it:

| version | BIM measured | within 5% | within 10% | what it did wrong |
| --- | --- | --- | --- | --- |
| none (baseline) | 475 | 454 | 457 | — |
| ends only | 512 | 407 | 424 | door leaves and casework off wall ends carved rooms up |
| + must continue the wall | 484 | 428 | 436 | collinear casework returns still cut the clinic's rooms |
| + probe must complete | 478 | **445** | 451 | 9 rooms past 5% on the clinic and kit-office |

With the final version, on the real sheets (every candidate offered, hatched
singles inside the building):

| sheet | before | after |
| --- | --- | --- |
| Joplin A-101 p46 | 19 of 74 closed, 54 merged, 2 open | **26 closed, 47 merged**, 2 open |
| Joplin p47 | 11 of 78 closed, 2 merged | 16 closed, 4 merged |
| Bunkie A100 | 4 of 6 measured, median 1.7% | 6 of 6 measured, median 2.4% (E100 and the corridor close) |
| Baker A101 | 7 of 9, median 2.0% | 7 of 9, median 2.7% |
| Camp Clark G-101 | 9 of 12, median 5.0% | 9 of 12, median 17.9% (a bridge splits a barracks room) |
| Supreme Court p6 | 1 of 7 | 1 of 7 |

So it does what it was built for — Joplin's rooms stop merging into the
corridor, twelve more close, Bunkie completes — and it is not free: 9 BIM
rooms and a Camp Clark barracks room past 5%. Diego's bar was that BIM must
not get worse, so the option ships OFF and the numbers stay here. What would
make it safe is a glazing CLASS from the finder rather than "any collinear
stroke" (§10, item 5): a line the drawing itself marks as glass cannot be
casework.

## 12. Ceilings from the reflected ceiling plan (2026-10-22, branch diego/ceilings) — built, measured, NOT wired

`ceilingTags.ts` + `realplan/zzCeilings.eval.ts`, keys in
`answer-keys/ceilings/<set>__p<N>.json`, crops in `shots/ceilings/`. Training
sets only; the held-out lists are the same ones every rooms eval carries.

**What an RCP prints, read from fourteen of them** (`coordination/
ceiling-tagtext.txt` is the text; `coordination/ceiling-inventory*.txt` the
page inventory). A ceiling tag is a STACK (Baker: name / `GB` / `10'-0"
A.F.F.`; Topeka: `C2` / `9' - 0" AFF`), ONE item (Murray `8'-0" ACT`), a
height ALONE in a hexagon or a box (Joplin, MHK, E Street), a height SPLIT
over items (NG `9'` + `0" A.F.F.`, Bunkie `10' - 0"` + `A.F.F.`), or a type
alone (`2X4 ACT`, `OPEN TO ABOVE`). Codes mean what the sheet's CEILING
LEGEND or FINISH SCHEDULE says (`ES`, `C1`…`C5`, `L=LAY-IN ACOUST. TILE`),
folded to four families — ACT, GYP, OPEN, OTHER. Five of the thirteen RCPs
carry the TYPE as a hatch pattern and print only a height (Joplin, MHK,
Topeka, Bunkie, MO Fairgrounds); nothing in text names it there.

**The room is the printed tag, not the polygon.** An RCP draws its walls
thin and its ceiling grid heavy: on Baker A111 the rules' finder closes 5
rooms of 13, and the raw pairings pair the 2x4 grid into 653 "walls". The
RCP does repeat every room's name and number, so each ceiling tag is
paired with a room TAG — the name printed over it, the stack above it, the
polygon it shares with exactly one room tag where one closes, else the
nearest within 25 ft — and the type and height need no polygon at all.
Areas still do, and that is the half that is not done: per-family square
feet below come from the polygons that close on the RCP, which is few.
The honest source is the floor plan's rooms joined by number, which this
branch does not wire yet.

**Against the keys, 10 RCPs, 66 rooms transcribed from crops:**

| | right | of |
| --- | --- | --- |
| rooms joined to the sheet's own room tag | 59 | 66 |
| ceiling height | 46 | 55 |
| ceiling family | 21 | 36 |
| tags read, where the key counts them | 95 | 102 |

The 7 rooms not joined: Baker's IDF and HALLWAY (the name line over the
tag is not found), Topeka 1002 (its room tag is not read), and SW's four.
The 15 missed families are the hatch sheets (Joplin 10, MO Fairgrounds 3,
MHK 1) and SW, whose boxed codes the room-tag reader takes for room
numbers and whose schedule reads two of three rows. The 9 missed heights:
MHK's boxed heights under four toilets (the stack is five line-heights
tall), Joplin's classroom 123 where the soffit hexagon wins over the
ceiling hexagon (both bare, the rule takes the higher — and the higher is
17 ft, two rooms away by the nearest-tag rule), Murray's corridor 110,
Topeka 1010, Bunkie E103 (nearest-tag errors a closed polygon would
settle).

**Refusals that mattered.** A legend row counts only under a title that
says ceiling, and never a one-letter code from a titled block (Murray's
`G`, `J`, `K` are light fixtures; Camp Clark's `G=GYP. BD.` is inline and
counts) — the first pass read Murray's keynote table as an 18-row legend.
A bare height is a tag only when something is drawn on all four sides of
it and no long line runs through it (Joplin's `8'-0"` dimension strings
along hall 138 are not tags), or when it is stacked under a room number.
`D5` over `A-103` is a detail callout. `8'-0"±` is a height.

**For the second session.** `ceilingHeightFacts(sheet, tags)` hands the
tags back as `HeightFact`s of kind `ceiling-height`, the shape
`wallHeights.resolveHeight` consumes, with the phrase and sheet — so the
wall-height chain can take the RCP's figures per ROOM from here rather than
the sheet-wide commonest A.F.F. that `heightFactsFromText` reads. The
three height-reader files are on this branch unchanged (dbf7fb18, from
99b70643) for that import; their NOTES section merges from their branch.

**Not done, in order of what it would buy:** (1) hatch reading per room —
stipple, grid, diagonal — which is the type on five of thirteen sheets and
every missed family; (2) areas from the floor plan's rooms by number; (3) a
second pass on SW's schedule and MHK's deep stacks.

## 13. Ceiling TYPE from the drawn pattern (2026-10-22 eve) — family 22/36 → 33/36

`ceilingPattern.ts` + the pattern arm of `realplan/zzCeilings.eval.ts`;
crops per room, named by what was read, in `shots/ceilings/pattern__*/`
(`<room>-<kind>-<family>.png`, from `eval-out-ceilings/crops__*.json`).

**What is read.** The strokes in a window round the room's printed tag —
not a polygon, since an RCP's rooms rarely close — sorted into lines that
span the window, tiny strokes, and diagonals. A GRID is four such lines on
one spacing one way and two the other (or three and three), the spacing
being the most common gap between any two lines within 1.6–6.5 ft that at
least three lines sit on as a chain: light fixtures and diffusers put extra
lines at odd positions, so consecutive gaps are irregular on every real
grid and the first version saw none. Measured spacings come out 2.0x2.0 and
4.0x2.0 ft where the sheet says 2x2 and 2x4; Topeka's 2x6 reads 1.7x2.6 at
its 3/32" caption. STIPPLE is a tiny stroke per three square feet; JOISTS
five parallel lines at 0.8–2.5 ft with nothing across; DIAGONAL eight
slanted strokes. The window is at most 8 ft half a side, never past 45% of
the way to the next room tag, and never under 4 ft; a tag crowded by a
neighbour's gets a second window stepped away from it, and the one that
says more wins (that is what reads Joplin's clerical workstations beside
two toilets).

**The mapping is the sheet's own legend swatches first.** The box beside
each ceiling-worded legend line is read with the same code and names which
pattern THIS sheet draws for which family — Joplin's diagonal is "gyp
board with wood veneer", not open structure. Where a sheet draws no
swatches the convention applies: grid → ACT, stipple → GYP, joists → OPEN,
diagonal → nothing. Order per room: a tag's family, then the pattern, then
the sheet's note.

**Against the same 66-room keys as §12:**

| | before | with the pattern | of |
| --- | --- | --- | --- |
| ceiling family right | 22 | **33** | 36 |
| heights, tags, joins | unchanged | 46/55, 96/102, 59/66 | |

Joplin goes 0 → 9 of 10, MO Fairgrounds 0 → 2 of 3; the three left are
narrow rooms — Murray's corridor 110, Joplin's hall 138, the Fairgrounds'
mechanical room 102 — whose 8-ft window takes the neighbours' stipple. A
closed polygon would clip them, and that is the rooms-on-RCP problem from
§12 rather than a pattern problem. Nothing was tuned on a held-out set.

**One more tag shape fell out:** MHK's `OPEN TO` / `STRUCTURE` / `ABOVE`
over three lines, which is the one family that moved in the "before"
column (21 → 22).


## 14. Area per ceiling family, from the floor plan's rooms (2026-10-22 night) — ceilings-v1

The RCP's rooms rarely close, so the area join goes to the FLOOR PLAN of
the same level: its label walls (accepted + traced) plus the finder's raw
pairings, rooms by `roomsFromWalls`, joined to the RCP's rooms by printed
number or name (`floor` in each page spec of `zzCeilings.eval.ts`;
`ROOM_KEYS` adds the printed areas keyed for the rooms work).

| sheet | RCP rooms joined | sf by family (joined rooms only) |
| --- | --- | --- |
| Baker A111 ↔ A101 | 9 of 14 | ACT 1,757 · GYP 1,056 — 6 printed areas, median 2.7%, 6 within 10% |
| Crosslines ↔ A100 | 11 of 19 | ACT 2,046 (2x4 ACT 1,546) · OPEN 1,366 · GYP 282 |
| MHK ↔ A1.01 | 13 of 25 | ACT 1,235 (2x2 798) · GYP 64 · unknown 5,033 |
| Joplin A-103 ↔ A-101 | 11 of 70 | ACT 639 (2x2 464) · GYP 434 · unknown 136 |
| Camp Clark ↔ A-101 | 5 of 11 | GYP 805 · ACT 343 · OPEN 218 |
| Bunkie ↔ A100 | 5 of 9 | GYP 354 · ACT 134 — 5 printed areas, median 1.7%, 5 within 10% |
| Topeka ↔ p74 | 4 of 24 | mostly unknown |
| Murray, Supreme Court, Fairgrounds, SW, NG, E Street | 0–1 | — |

59 of 248 RCP rooms joined; every one of the 11 with a printed area is
within 10%. The two reasons a room does not join, counted over the
thirteen sheets: **the floor room did not close** (50) — the same rooms the
rooms evals leave open, and the thing that limits this; **no such tag on
the floor plan** (62) — RCP tags that are keynotes, fixture marks or sheet
numbers (E Street's `D53.13`, Joplin's `A-103`), which inflate the 248,
plus real rooms whose floor tag was not read. Murray is its own case: the
RCP and the floor plan share the sheet and every room number, and the
room finder places none of the duplicated tags. Supreme Court's floor plan
is hatch (39,474 raw pairings, 0 rooms).

**Frozen as `ceilings-v1`** (the commit this section lands in), before the
one held-out look in §15.

## 15. The one held-out look, ceilings-v1 (2026-10-22 night) — type 9/21, height 5/12

Run ONCE on `ceilings-v1` (e61a529f), keys written from the page renders
and grid crops BEFORE the run (`answer-keys/ceilings-heldout/`, crops in
`shots/ceilings-heldout/`), nothing changed after. The three buildings'
ceiling information comes in three different forms, and v1 was built for
one of them.

| building | where the ceilings are | rooms keyed | joined | family (with pattern) | height | tags read |
| --- | --- | --- | --- | --- | --- | --- |
| Albany A-100 | RCP view on the floor-plan sheet, no room tags, one note OPEN TO STRUCTURE | 4 | 0 | 0/4 | — | 1/1 |
| KSU A150 (ground) | RCP with name/number tags, height over a finish code (AC01, PA01/PA03), NO CEILING, OPEN TO EXIST notes | 17 | 17 | 7/17 | 5/9 | 6/17 |
| O'Reillys A1.2 | no RCP at all: a finish SCHEDULE by room, C-1…C-4 in a finish legend | 6 | 4 | 2/4 | 0/3 | 0/0 |
| **all** | | **27** | **21** | **9/21** | **5/12** | **7/18** |

Area per family joined 4 of 39 RCP rooms (KSU only, 177 sf ACT, 308 sf
GYP); the training figure was 59 of 248. Nothing printed an area on these
floors to check against.

**Failure list for v2, in order of what it would buy here:**

1. **Finish CODES without a legend on the sheet** (KSU `AC01`, `PA01`,
   `PA03`): the reader knows ACT/GB/GWB/ES and the sheet's own legend, and
   KSU's legend is on a finish sheet elsewhere. A prefix rule (`AC` =
   acoustical, `PA` = paint on what is there, `GB`/`GY` = gypsum) or the
   finish legend read across sheets. Every KSU family and four of its
   heights fall to this: the heights were READ (6 with height) but the
   stack's code was not a type, so the tag paired to nothing in four rooms.
2. **Two-line notes** (`NO CEILING,` / `OPEN TO EXIST`): the wrap rule
   takes `OPEN TO` + `STRUCTURE|ABOVE`; `OPEN TO EXIST` and the line above
   it are a third spelling. Eight of KSU's seventeen rooms.
3. **An RCP with no room tags, beside its floor plan** (Albany): the rooms
   and their printed areas are in the other view of the same sheet, at the
   same scale. Transfer the floor plan's room tags into the RCP view by the
   views' offset, or take the single building-wide note as every room's
   answer when the RCP prints one note and nothing else.
4. **A ceiling SCHEDULE instead of an RCP** (O'Reillys): a table with
   CEILING TYPE and HEIGHT columns by room number, and the types in a
   finish legend (`C-1: TYPE: ACOUSTICAL TILE CEILING`). The second
   session's schedule-table reader is the right tool; this reader never
   sees a table.
5. **Pattern on existing construction**: KSU's open-to-existing rooms
   draw the plaster above as a stipple and read GYP; its painted-plaster
   fire riser room reads grid. The pattern is right about what is drawn and
   wrong about what is bid, which only the words settle.
6. **The view detector did not name Albany's `FIRST FLOOR RCP`** as a
   ceiling view, so the whole page was read as one.

The number to carry: on buildings whose RCP prints a height-over-code
stack with room tags (KSU, like Baker and Topeka), v1 joins every room and
gets the height where it reads the tag; the type is the legend, and the
legend was not on the sheet.

## 16. Ceilings v2 (2026-10-23) — the held-out failures, fixed on training sets only

KSU, Albany and O'Reillys were used for nothing here. Each fix is measured
on training sheets; where no training sheet exercises it, that is said.

| fix | where it is measured | result |
| --- | --- | --- |
| 1. legend read across the set + prefix guess (`familyFrom: "prefix"`) | SW's own CEILING FINISH SCHEDULE (its rows were misread as column labels) | SW 0 → 4 of 4 rooms joined and right; the set scan reads rows on Baker A601, Murray, Joplin that no RCP needed; **no training RCP uses a prefix-only code, so the guess is unit-tested and unmeasured** |
| 2. wrapped notes as one phrase | MHK `OPEN TO / STRUCTURE / ABOVE`; Supreme Court `OPEN TO / ABOVE` | reads as one OPEN note; no keyed room changed |
| 3. ceiling SCHEDULE by room, over `tableRowsFromPage` (second session's, not forked) | Bunkie p51 | 13 rooms with a ceiling column, E101–E104 GYP.BD. 10 ft, matching the Bunkie RCP key's four heights |
| 4. room tags carried into a tagless RCP view (`viewAlign.ts`, a vote of matching walls) | Murray, pretending its RCP view has no tags | 12 walls agree; 7 of 14 carried tags land within 3 ft of the RCP's own tag of the same number; the rest have no same-number tag in that view |
| 5. words beat the pattern; KEYNOTES that name a ceiling (`existing`) | E Street A1.3 demolition RCP, 12 rooms keyed | joined 12, family 8 of 12; the 16 rooms flagged existing keep their words whatever the stipple says |

**And one more, found on the way.** `sheetViews` alone gives every view
the whole page as its box, so v1's "the RCP's own view" never excluded the
floor plan beside it (Murray's two views both read `[0–1 × 0–∞]`).
`viewsInRegions` gives the measured regions — and used blindly it was
WORSE: Joplin's "overall RCP" region kept 0 of 16 keyed rooms, because the
gutters cut the plan into cells the detail captions claim. So the region
is used only where it holds at least half the page's room tags (Murray,
Topeka, Crosslines, Camp Clark, Bunkie), and the whole page otherwise.

**All training keys, 14 pages, 78 rooms (the v1 66 plus E Street's 12):**

| | v1 (§12–13, 66 rooms) | v2, same 66 | v2, all 78 |
| --- | --- | --- | --- |
| joined | 59 | 63 | 75 |
| family right | 33/36 | 36/40 | 44/52 |
| height right | 46/55 | 47/55 | 48/66 |
| areas joined | 59/248 | — | 61/250, 11/11 printed within 10% |

E Street's heights (1 of 11) are the nearest-tag pairing again: its `9'-0"`
marks sit between rooms and go to the wrong tag. Still open from §15: a
two-level schedule header (O'Reillys' CEILING over TYPE | HEIGHT) is not
read, since the table rows carry no x positions.

## 17. Ceilings in front of an estimator (2026-10-23) — Rooms panel, OFF behind the room-finder switch

`roomCeilings.ts` (`ceilingsForRooms`, `ceilingSummary`), the Rooms panel's
three new columns, `Company.roomFinderOn` as the switch (ceilings live in
the Rooms panel, which only exists with the room finder on, so no second
switch and no Company migration), and migration `20261023120000_room_ceilings`
— five additive columns on `TakeoffMeasurement`, applied only to the e2e
runner's throwaway Postgres and a local `_dbtest` scratch database.

**Where the reading happens: the browser.** The page's words are already
read from the open PDF for the room tags; the ceiling pages are read the
same way when Find the rooms is pressed — `ceilingPages` from
`workspaceLoad` (pages whose stored title block says reflected ceiling
plan, RCP or finish schedule), or every page of a plan of forty or fewer
when the index names none, kept if its own text does. Strokes for the
pattern are the current page's, from the last find. Schedule pages go
through the second session's `tableRowsFromPage`, unchanged.

**Per room, in order:** a tag on any page that says existing or no
ceiling; a tag (own sheet or ceiling plan, joined by printed number or
name — Baker's name-over-code stacks join by name); the schedule row; the
drawn pattern on this sheet; the sheet's note. The source is shown beside
each row ("ceiling plan tag p14", "finish schedule", "drawn pattern",
"sheet note", "guess from the code" with an amber GUESS badge), and an
estimator's edit replaces it with "typed by you" and clears the guess.

**Proved in a browser**, `e2e/specs/takeoff-ceilings.spec.ts` on the S05
fixture (no ceiling information, so every row reads "nothing read"): a
type and a height typed in move the sheet summary at once; saving stores
them; after a reload and a fresh find, "Saved on this job" reads them back
within 2% of the room's square feet. `takeoff-ceilings-real.spec.ts` uploads
Baker's A101 and A111 as one two-page PDF and reads the ceilings off page
2 for the rooms closed on page 1 — see §17's run notes below.

**Not done.** A two-level schedule header (O'Reillys' CEILING over
TYPE | HEIGHT) — no training set prints one, so nothing to measure it on;
noted for later with the fix: the table reader keeps cell geometry, and
the group heading's span over the sub-columns is what maps it.

**Baker, in the app (A101 + A111 as one two-page upload, scale set by the
spec's half-sheet click, so the areas are approximate):** 7 rooms closed on
the floor plan; 5 took family AND height from the ceiling plan's tags on
page 2 (HAM RADIO/COMM, STORAGE, RR 1 → gypsum board 10 ft; CALL CENTER,
CONFERENCE → acoustical tile 10 ft); IDF and one unnamed room read nothing.
Sheet line: acoustical tile 872 sf · gypsum board 387 sf · no ceiling read
416 sf. Screenshot and the per-room text in `shots/ceilings-app/`.

Two things the first run of that spec taught, both fixed in `roomCeilings.ts`
and pinned by a test: a FLOOR PLAN's own figures are dimensions, not
ceiling heights — the sheet the rooms sit on is a tag source only when it
says it is a ceiling plan too (Murray's combined sheet) — the first run read
18.5 ft over STORAGE from a dimension string; and Baker's floor plan says
CALL CENTER 111 where its ceiling plan says 911 CALL CENTER, so a room joins
by one name containing the other (four letters or more) when the number is
not printed on the ceiling side.

## 18. The estimate end of the chain (2026-10-22) — diego/estimate-chain off main

The audit (`coordination/takeoff-to-estimate-audit.md`) found four things
measured and never priced. Fixed, smallest form each, all behind the switches
that already gate them (room finder for rooms/ceilings; the legend library's
own gate for heights and the U.N.O. offer):

- heights: `addWallTypeFromLegend` → `setHeightFacts` (sections, ceiling
  plans, lettered and general notes, up to 120 pages) → `resolveHeight` →
  `defaultHeightFt` + the chain in notes; LOW when only a general note.
- U.N.O.: `wallGroups` keeps the GENERAL_NOTE source but the verdict is ASK
  with `suggested` first; `BY_GENERAL_NOTE` is gone from the union.
- rooms → "Rooms" item; ceilings → one AREA_WITH_PERIMETER item per family,
  a second row per room with the same outline (one row belongs to one item;
  a floor and a ceiling are two things priced). The ceiling columns ride on
  the ceiling row only, so the panel's job summary counts each once.
- seeds ACT2 and GYPC1; studs on items ON (Diego's production query on
  2026-10-22 found 0 measured items with a STUDS part, so the flag went).

Not done: openings on item walls (door schedule reads exist as evals only);
per-run heights from a room's ceiling height.

**Branches, 2026-10-22.** `diego/estimate-chain` (off main) is the canonical
ceilings branch: it carries every commit of `diego/ceilings` — the app side
by three-way apply, the six evals (`realplan/zzCeiling*.eval.ts`,
`zzWallHeights.eval.ts`) and their key-census exemptions by checkout. The
two branches differ only in files `diego/ceilings` inherited from its
`diego/takeoff-audit` base and never touched (`offeredCandidates.ts`,
`personas.ts`, two specs). `diego/ceilings` is retired: left in place, not
deleted, not to be built on. It ships with `diego/demote-mode` (rebased onto
main) as PR B — `20261023000000_demoted_walls` then
`20261023120000_room_ceilings`.

## 19. What the Baker walkthrough showed, and the six fixes (2026-10-22)

`e2e/specs/estimator-baker.spec.ts` walks the whole takeoff on a real set in
a throwaway stack (set read from disk, inventory real, legend from the cached
read) and writes every panel's sentences beside the screenshots. The first
run's ranked findings are in `shots/estimator-baker/FINDINGS.md`; the six
Diego picked, and where each landed:

1. **Concrete types got metal studs** — `addWallTypeFromLegend` handed
   `assemblyFromSight` `studMaterial: null`. Now `sightFieldsFor` reads the
   sight read's material by code and a concrete or masonry type is written
   board-and-insulation only (the legend fixture's P6 proves it in Chromium).
2. **"Add these" wrote loose measurements in silence** — `groupChoices`
   (`wallGroups.ts`) lists what an unpriced group may become, types first,
   plain last; the viewer's chooser (`data-takeoff="group-choice"`) must be
   answered before `add-group` enables; "create" leaves for `/wall-types`
   with the thickness filled in. The wall-type form gained a thickness
   field, without which a hand-made type can never be offered for a group.
3. **S6B / S6C read identically** — `wallTypeSummary` (board one side or
   both, layers, rating, insulation, wood studs) rides on
   `MatchableWallType.summary`, in the option label and the ASK sentence.
4. **Height only after Add** — `legendHeightsFor` (`legendHeights.ts`) is
   shared by the review page and the action; the row shows
   `15 ft · LOW — general note only, check the sheet` before Add.
5. **"Not enclosed" listed the title block and notes** — `looksLikeNoteText`
   drops title-block vocabulary, sentences and names over six words; "Rooms"
   is a check figure (`roomItems.ts`), reported as square feet of floor.
6. **Find the walls answered a click before the sheet rendered** — the
   button is disabled on `!pageSize` and its title says so.

## 21. Sheet names and scales from the list (2026-10-26) — diego/sheet-scale off diego/customer-features

Walkthrough findings 6 and 7 (§19's "still true" list): the rail said "65 need
a scale", the picker said "Sheet 5", the scale form's name box was blank. All
three are the same gap — the inventory reads every page's text and scale with
no model, and nothing customer-facing used what it read until the paid
title-block step ran. Everything here is OFF until the company turns on the
plan-text read (`PLAN_TEXT_READ`), the switch the rest of drawing-text reading
sits behind; with it off, the rail, picker and form are exactly as before.

**Names.** `pageInventoryWork` gained a port, `saveSheetProposal`, and writes a
`PlanSheetProposal` per readable page whose corner or region yields a
designation (`sheetNumberFrom`): HIGH from the corner, MEDIUM from the region,
`model: "keyless title-block reader"`, so the review index can tell it from a
model's. The title comes from `nameSheet` (the eval-only glyph-height reader,
now a product dependency) ONLY when its lettering is at least 1.3× the block's
median height (`distinct`); a title at the block's own size is boilerplate
until a model reads it — the synthetic fixture proved that the hard way, giving
"ZZ SYNTHETIC ARCHITECTS PROJECT: … ISSUED: 2026-03-04" as a title. The
model's later proposal, being newer, still wins where it runs. The scale form's
name box reads the sheet index's label when the page has none of its own.

**Ranking.** `looksLikeFloorPlan(number, title, discipline)` in `sheetTree.ts`:
an A-sheet whose title says plan and not a plan of something else (ceiling,
roof, site, framing, demo, enlarged, life safety…), or an untitled A-1xx.
`buildSheetTree({ rankPlans })` puts a plan that still needs a scale first in
its group; the progress line adds "N floor plans to scale, listed first".

**One press.** `printedScaleOffers(groups)` groups every unscaled sheet that
prints a scale by what it prints; the rail renders one button per scale
(`data-takeoff="use-printed-scale-everywhere"`). `applyPrintedScales(jobId,
planId, pages)` (`lib/actions/takeoff.ts`) writes a calibration per page from
that page's OWN `PlanSheetScaleReading` — its anchored line and declared feet —
through `calibrationRefusal` like the single form; already-calibrated pages
and pages with no reading are skipped and named in the status line. No wall
detection is kicked off (that stays per sheet, on opening it). Excluded from
Ask's registry with the other scale writes.

**On Baker (training, `shots/estimator-baker-sheet-scale/BEFORE-AFTER.md`).** The
inventory named 59 of 65 pages, every one HIGH from the corner; the six it
could not are the civil sheets with no corner designation, which stay "Sheet
N" until the paid step. 29 pages print a readable scale (4 checked against
dimensions, 25 printed only). The rail opens on the ARCHITECTURAL group with
the two floor plans first, "2 floor plans to scale, listed first", and six
buttons; one press set 18 sheets from their own 1/8" readings and the floor
plan opened already scaled, at the same scale the per-sheet offer gave on
the previous run — same 12 groups, same first-group footage. The walkthrough
spec (`estimator-baker.spec.ts`) no longer seeds proposals; it reads what the
inventory wrote, presses the first offer, and skips the scale form when the
sheet's own line (`data-takeoff="sheet-scale-state"`) already says set.
Known soft spots: a title repeated on two sheets (the RCP reads as its keynote
legend), drawing titles appended to a sheet title, and a header of six
buttons on a set with six printed scales.

`applyPrintedScales` is covered by `takeoff-printed-scales.dbtest.ts` on a
scratch Postgres: two pages with DIFFERENT declared feet each get their own,
a scaled page and an unread page are skipped and named, the note says
checked-or-not, and another company's call is refused.

## 22. Tags without the AI switch, and the tag over the thickness (2026-10-26) — diego/tag-typing off diego/sheet-scale

Two more walkthrough findings. No browser run on this branch: the shared Clerk
development instance was rate-limiting every caller that day, so the proof is
unit tests, a database test on a scratch Postgres, and a keyless eval on the
training floor plans. The e2e to run when Clerk is quiet is listed at the end.

**Tags.** `findWallsOnSheet` runs the symbol reader only when handed a
`planText` vocabulary, and `detectWallsForCalibration` handed it one only
with PLAN_TEXT_READ on — the legend's codes, read by a model. The symbols
themselves are free geometry. `tagVocabulary(libraryCodes, legendCodes)`
(`planTextTags.ts`) now builds the vocabulary from the company's own
wall-type codes always, plus the legend's when read, and detection passes it
whenever it is non-empty. Nothing in the finder files changed: the field is
still `legendCodes`, and its doc now says what goes in it. A company with no
wall types gets exactly the detection it had.

**Tag over thickness.** `settledType(verdict)` (`wallGroups.ts`) is the one
answer to "is this group settled with nobody asked": NAMED and
ONLY_ONE_THAT_THICK as before, and now TAG_DISAGREES — the drawing printed
the name, and a legend's figure is studs plus board where the drawn wall is
ICF, furring or finishes. The sentence says both numbers, that the tag wins,
and that the tag may belong to the wall beside. The row offers "Update C8B's
thickness to 11-1/4"" → `setWallTypeThickness(jobId, typeId, inches)` in
`lib/actions/wallTypes.ts` (the takeoff page's capability, as the guard
census requires; only the thickness column moves; dbtest on a scratch
Postgres). An untagged group is still matched by thickness only, within
`THICKNESS_SLACK_IN` (a quarter inch, half the cluster width) — unchanged,
and the eval below says how much that leaves UNKNOWN.

**Measured** with `realplan/tagTyping.eval.ts`: the finder on each training
set's floor plans (named by the keyless reader, biggest three by strokes),
library = the set's cached legend types (thickness by the walkthrough's
studs-plus-board rule) + the eight starters (W1, W2, W3, EW1, FIN5, ACT1,
ACT2, GYPC1 — the window-mark risk, since a drawing's windows are often W1),
four conditions: switch off before/after, switch on before/after. Held-out
sets excluded, including the three plan-text ones the shared list does not
name (the harness's first run included two of them by that gap; their rows
were discarded unread and the exclusion added). Figures in
`shots/tag-typing/all/tag-typing.txt`, outside git.

**What it showed (switch OFF, before → after; the switch ON is identical to
"after" on every sheet, because a library holding the legend's codes IS the
legend's vocabulary).** Thirteen training floor plans across five sets with a
cached legend; one (Murray A402) had no sheet-wide scale and measured nothing.

| sheet | groups tagged | ft tagged | of which TAG_DISAGREES |
| --- | --- | --- | --- |
| Baker A101 | 2 → 9 | 50 → 255 of 911 | 1 g 39 ft → 7 g 221 ft |
| Baker A100 (overall) | 0 → 0 | 0 of 1,997 | — |
| E Street A2.1 / A3.1 | 0 → 6 / 0 → 4 | 196 of 1,071 / 153 of 658 | none |
| NG Green Bay A3.2 | 0 → 18 | 634 of 1,483 | 13 g 495 ft |
| SW Grand Junction A110 | 9 → 11 | 255 → 336 of 1,946 | 4 g 81 ft → 5 g 142 ft |
| the other seven | 0 → 0 | — | — |

No starter code (W1, W2, W3, EW1…) was ever picked up as a tag on any sheet:
the window-mark risk did not materialise on these sets. Two cautions. On SW
A110 the text-tagged C3 group (91 ft, NO_SUCH_TYPE) disappears once symbols
are read and B2 grows from 13 to 110 ft — a symbol tag outranking a bare text
tag on a neighbouring run; nobody has looked at that sheet to say which is
right. And the TAG_DISAGREES footage is the measure of finding 2: before, all
of it ASKED; after, it prices as its tag (Baker 221 ft, Green Bay 495 ft, SW
142 ft), with the drawn-vs-library numbers said beside it. Whether every one
of those tags is on the right run is exactly what the sentence tells the
estimator to check, and the eval cannot.

The harness's first two runs ALSO measured lodi-memorial-library and the
Missouri pavilion — plan-text held-out sets the shared `HELD_OUT_SETS` does
not name — because the edit adding the exclusion failed silently in a
background shell. Their rows were deleted from both outputs without being
used for any decision; the exclusion is in the eval now. Recorded so the
next person does not trust "held-out excluded" on the strength of the
shared list alone.

**E2E to run when Clerk is quiet** (not run here, by instruction):
`takeoff-wall-legend.spec.ts` and `estimator-baker.spec.ts` steps 4–5 with
the plan-text read OFF — the found groups must carry the drawing's tags, a
TAG_DISAGREES group must show "Add as <code> — priced" and the
`data-takeoff="update-thickness"` button, and pressing it must change the
type under /wall-types; then the same with the read ON, which must not
change the groups.
