# Wall types: what the drawing names, carried along the wall, and onto the estimate by type

Written 2026-10-29 with the branch that measured it (`diego/pilot-wall-types`).
What existed before this round, all of it real and measured by the sessions
that built it: the tag readers (`wallTags.ts` text, `symbolTagging.ts`
symbols, `bareTextTags.ts` loose codes), the legend read (`readWallLegend.ts`,
a model call, cached per set), the vocabulary filter (`planTextTags.ts`),
propagation along collinear runs (`typePropagation.ts`), the groups (tag
first, thickness as a shortlist, a U.N.O. note — `wallGroups.ts`) and the
match to the company's own types (`wallTypeMatch.ts`). What was missing
was a number: nobody had measured, sheet by sheet, how much of a floor
plan's footage ends up with a type — and the whole-set run posted every
foot against one assembly.

## 1. The measurement (`realplan/wallTypes.eval.ts`)

For each labelled training floor plan, the finder runs with the set's
legend codes as the vocabulary (the second session's cached model read
standing in for the WALL_LEGEND proposal; Joplin's by hand from its G-111
sheet, `answer-keys/legends/`), and the groups are summed by source.

| sheet | runs · ft | before: typed | after: typed (tagged / carried / note) | per type |
| --- | --- | --- | --- | --- |
| Joplin A-101 (p46), legend A/B/K/L/V + suffix types | 199 · 3,535 | 5% (no legend; text tags only) | **56%** (20 / 7 / 29) | A3 522, B 122, A 116, L 108, B2 56, V 25 |
| NG Green Bay A3.2 (p10) | 92 · 1,680 | 36% | **47%** (36 / 11 / 0) | IW-7 408, IW-2 144, IW-4 128, IW-5 31 … |
| Baker A101 (p13), legend S6A…C8B | 54 · 914 | 36% | **38%** (32 / 5 / 0) | C8B 230, S8C 50, S6A 33, S8B 31 |
| SW A110 (p5), legend A1–A4/B1–B3 | 119 · 1,806 | 20% | 19% (18 / 1 / 0) | A3 165, A1 133, B1 25, B2 13, A4 9 |
| E Street A2.1 (p28), legend 2/3/4/8 | 111 · 1,255 | 15% | 16% (13 / 2 / 0) | 2 165, 8 33 |
| Bunkie A100 (p31), legend P06–P09/EXT | 63 · 1,061 | 11% | 13% (10 / 3 / 0) | P08 86, P09 57 |
| MHK A1.01 (p32), legend 1–4 | 66 · 1,698 | 6% | 6% | 4 109 |
| Crosslines A100 (p10), legend A–G | 316 · 3,896 | 2% | 4% (2 / 2 / 0) | D 129, F 8 |
| Murray A101 (p24), legend WALL TYPE 1/2 | 178 · 2,436 | 4% | 4% | C2 57, C4 24, WALL TYPE 2 24 |
| Bunkie A104 (p35), NG Green Bay A3.1 (p9) | | 0% | 0% | no tags on the sheet |
| Glen-hazel A-101 (p6), A-111 (p13) | 99 · 1,899; 207 · 2,473 | 0% | 0% | see §4 |

"Before" is the branch's base with the same legend; the before/after
difference is §2. Read the table as what it is: on most training sets the
drawing tags a quarter of its footage or less, and nothing in this round
changes how many tags a drafter printed.

## 2. What changed

1. **Carried round a corner** (`typePropagation.ts`). Collinear carrying
   typed under 4% of the footage on every sheet, because a tag's wall ends
   at the room's corner and the room's next wall starts there. A run of the
   same thickness whose END meets the walked endpoint, and nothing else
   meeting it, is the wall continuing. Two runs leaving the point (a stem
   into a split crossing wall) is a question and the walk stops; a wall the
   endpoint lands in the MIDDLE of is passed by, not continued. Green Bay
   36 → 47%, Joplin's carried 95 → 233 ft; conflicts 0 everywhere.
2. **The legend's own U.N.O.** (`wallTypeMatch.ts` `unoNote`, `wallNotes.ts`,
   `wallGroups.ts`, `planTextRead.ts`, `detectWallsForCalibration.ts`).
   Joplin prints "ALL INTERIOR DRYWALL PARTITIONS … ARE TYPE 'A'" and "ALL
   INTERIOR MASONRY PARTITIONS … ARE TYPE 'B'" on its partition sheet, not
   on the floor plan, so `defaultWallTypeFromNotes` found nothing. The
   sentence now travels on the type (`unoNote`, from the stored legend read's
   `uno` list) and is the fallback when the sheet has no note of its own.
   Each default covers its OWN thickness only — a "nearest family" rule was
   tried and typed Joplin's 6 in stud partitions (A3, 7-1/4 in) as CMU B
   (7-5/8 in); those buckets are a question, which `verdictFor` asks.
   Joplin: note 0 → 1,029 ft. The model's legend read does not write `uno`
   yet; Joplin's comes from the hand key.
3. **A detail callout is not a tag** (`symbolTagging.ts`, `planTextTags.ts`).
   Joplin's "A3" over "A-621" in a split circle, and "B4/ A-621" beside a
   filled triangle, were read as types A3 and B4 — 203 ft of A3 on a sheet
   whose A3 tags are elsewhere. A split symbol with a sheet number in one
   half is a callout; a text tag inside any symbol the symbol pass rejected,
   or within a third of an inch of a sheet number, is that callout's text.
4. **Onto the job by type** (`lib/plan-ingest/wallItems.ts`, after the
   WALLS stage writes a sheet). Each stored group goes to a takeoff ITEM per
   wall type — named by the tag, the tag carried, the legend's U.N.O. where
   it is the one type that thick, or the thickness alone where the company
   has one type that thick — as LINEAR measurements, `source: DETECTED`, the
   label saying which; the rest to "Walls — untyped". "Send to estimate"
   then prices each item with its type's assembly (`syncTakeoffItemLines`).
   Never twice. `wallItems.dbtest.ts`.

## 3. The pilot (harness in `shots/pilot/full3/`, legend stand-ins from the cache and the Joplin key)

| set | walls | on the job by type | untyped |
| --- | --- | --- | --- |
| Joplin A-101 | 3,595 ft | A 1,205 (U.N.O.), A3 674, B 156, V 135, L 108, B2 55, B3 20 — 2,163 ft, 60% | 1,240 ft |
| Baker A101 | 711 ft | C8B 240, S8C 50, S8B 35, S6A 33 — 358 ft, 50% | 352 ft |
| SW A110 + A400 | 1,706 ft | A1 132, A3 60, B1 31, B2 13, A4 9 — 245 ft, 14% | 1,461 ft |
| Glen-hazel (whole set) | 21,726 ft | P1 5,737 by thickness alone (the pilot's one type) | 15,990 ft |

Two things the pilot showed that a measurement on the finder alone does
not. Giving the company wall types with thicknesses moves the finder's
walls — Joplin 3,720 → 3,595 ft, 47 → 40 rooms — because the finder snaps
to known thicknesses; that is the product's behaviour with a library, not
this branch's. And a company with ONE type that is 4-7/8 in thick posts
every 4-7/8 in wall as it (Glen's 5,737 ft of P1): `settledType` treats a
unique thickness as an identity, which is right with a real library and
wrong with a placeholder, and the measurement label says "(by thickness)".

## 4. Glen-hazel: the T1/T2 tags are finish types

Looked for before anything was built. Glen's A-101 carries T4–T9 and EX in
squares beside the room numbers ("ASST. MGR. 109 T4"). The set's A-002
(p11/p12) defines T1–T9 as ROOM FINISH types — floor, base, wall paint,
ceiling columns ("T1 | LVT-1 | PT-3 | RB-3 | PT-2") — and `legendPages`
finds no partition legend on any of its 105 pages (the best candidate is a
window-detail sheet). So Glen's walls carry no wall-type tag, and 0% typed
is the drawing's answer, not a miss.

## 5. By eye, ten random runs per sheet (`WT_SEED`, crops in the scratchpad)

| sheet | right | wrong | notes |
| --- | --- | --- | --- |
| Joplin | 6 | 2 | 2 of 10 were legend-box borders the finder calls walls, typed A by the note at 5.1 in — finder junk, not a typing error; the A3 tags are plain circles beside 7.2 in walls (6 in studs: right); untyped 7.2 in and 8.0 in walls are the A3-or-B question, left open on purpose; a CMU wall with a B hexagon beside it was untyped (tag not reached) |
| SW | 5 | 1 | "A1" on the west exterior wall came from an A1/A115 section marker, not the A1 boxes the sheet draws its tags in; A3 beside the tint room (square boxes) right; brick exterior and the schedule's own table lines untyped |
| Baker | 4 | 0 | S6A and C8B boxes beside the walls they name; (E) existing-building walls untyped, which is right |
| Bunkie | 3 | 0 | untyped runs are a hatched wall with no tag and a grid of building-section hatch |
| MHK, Crosslines | 3 + 3 | 0 | untyped office partitions with no tag within reach; MHK's four "WALL TYPE n" circles tag four walls on a sheet of sixty-six |

## 6. Not built, recorded

- The legend read does not extract U.N.O. sentences (`uno`); the prompt
  change belongs with a model call this round could not make.
- Section markers that share a name with a wall type (SW's A1/A115 beside
  wall type A1): the split-circle rule catches the circle; the triangle
  marker's text is caught only within a third of an inch of its sheet
  number.
- MHK's tags are drawn as outlines, not text; 25 of 31 door marks and most
  wall tags are unreadable without OCR of the symbol.
- A note-typed group where two types share the thickness (Joplin A3 / B)
  stays a question; the item is "Walls — untyped" until a person answers.
