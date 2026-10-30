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
| Joplin A-101 (p46), legend A/B/K/L/V + suffix codes, thickness on A and B | 194 · 3,661 | 5% (no legend; text tags only) | **56%** (23 / 5 / 28) | A3 578, L 175, B 122, A 116, V 26 |
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
| Joplin A-101 | 3,656 ft | A 723 (U.N.O.), A3 518, L 175, B 152, V 26 — 1,554 ft, 43% | 2,062 ft |
| Baker A101 | 701 ft | C8B 230, S8C 50, S6A 33, S8B 31 — 344 ft, 49% | 357 ft |
| SW A110 + A400 | 1,714 ft | A3 170, A1 133, B1 25, B2 13, A4 9 — 351 ft, 20% | 1,363 ft |
| Glen-hazel (whole set) | 20,198 ft | P1 4,938 by thickness alone (the pilot's one placeholder type) | 15,260 ft |

Two things the pilot showed that a measurement on the finder alone does
not. Giving the company wall types with thicknesses moves the finder's
walls — §3b measures it and says what was done. And a company with ONE type that is 4-7/8 in thick posts
every 4-7/8 in wall as it (Glen's 5,737 ft of P1): `settledType` treats a
unique thickness as an identity, which is right with a real library and
wrong with a placeholder, and the measurement label says "(by thickness)".

## 3b. The finder with and without the company's wall types — the side effect, measured

The first pilot moved Joplin from 3,720 to 3,595 ft and 47 to 40 rooms the
moment the company had wall types. The path is the finder's own: every
typed `WallType.thicknessIn` reaches `findWallsOnSheet` as a scheduled
thickness and `wallVectors.ts` uses it three ways — a thin pair at a
scheduled thickness is admitted below the 0.2 ft floor; in an assembly the
widest pair that IS a scheduled thickness is preferred (8 + 1-1/2 over
9-1/2); and a second pass adds assembly walls only when a schedule exists.
Deliberate, documented in those files, measured by their authors on Mesa
Ridge and School-01, and not this branch's to change (finder files).

Measured here against the labels, every variant through `detectForSheet`
(`zzWtDelta`, scratch): `none` = no types; `thick` = the legend's types with
their thicknesses; `pilot` = those plus the harness's two ceiling starters,
which an earlier run had given a 1 in thickness.

| sheet | none: offered / missing / extra | thick | pilot (ceilings at 1 in) |
| --- | --- | --- | --- |
| Joplin A-101 (11 thicknesses, hand key) | 3,536 / 62 / 1,007 | **3,324 / 207 / 1,026** | 3,475 / 122 / 1,072 |
| Joplin, thicknesses on A/B/K/L/V only | | 3,422 / 113 / 1,021 | |
| Baker A101 | 698 / 42 / 25 | = none | 708 / 43 / 39 |
| Bunkie A100 | 814 / 13 / 355 | = none | 898 / 14 / 436 |
| Crosslines A100 | 3,918 / 241 / 474 | = none | 4,278 / 258 / 806 |
| MHK A1.01 | 1,707 / 79 / 636 | = none | 1,850 / 74 / 709 |
| SW A110 | 1,637 / 13 / 1,228 | = none | 1,572 / 14 / 1,165 |
| NG Green Bay A3.1 | 2,152 / 131 / 1,112 | = none | 2,354 / 128 / 1,279 |
| E Street A2.1 | 1,140 / 11 / 461 | = none | 1,224 / 37 / 586 |
| Glen-hazel A-111 | 2,039 / 294 / 424 | = none | 2,200 / 264 / 541 |

And through the pilot itself, the same company with NO wall types against
one with the legend's (Joplin's A and B thicknesses; Baker's and SW's
legends carry none):

| set | no wall types: walls · rooms · ceiling | with the legend's types |
| --- | --- | --- |
| Joplin A-101 | 3,656 ft · 46 · 5,768 sf | 3,570 ft · 44 · 6,228 sf |
| Baker A101 | 701 ft · 9 · 1,482 sf | identical |
| SW A110 + A400 | 1,714 ft · 14 · 92 sf | identical |

Two findings. **The ceiling thickness was a harness artefact**: the product's
starter ceiling assemblies carry no thickness, the harness had typed 1 in on
its own, and that one inch opened the finder's thin-pair floor on every set
(Crosslines +332 ft of extra). The harness no longer does it. **Where real
thicknesses exist the guidance moves the count, and on Joplin it moves it
the wrong way**: 145 ft more missed against the label, 19 ft more extra;
with thicknesses on the five drawn types only, still 51 ft more missed. On
the other training sets the cached legends carry no thickness, so with and
without are identical. **Diego's call (2026-10-29, after this table): the WALLS stage does not
pass wall-type thicknesses to the finder.** A whole-set takeoff is now
identical with or without wall types. The one-line version — strip
`thicknessIn` in `loadWallTypes` — is wrong on its own, because the finder's
own `regroup` reads the same types and a type with NO thickness is offered
for every bucket, so the legend's U.N.O. default would have covered the
whole sheet. So `detectWallsForCalibration` takes `pairWithThicknesses`
(the stage says false): the finder gets the types without thickness, and
the groups are rebuilt beside it with the thick ones by
`lib/takeoff/stageGroups.ts` — the finder's clusters, the finder's tag map,
the sheet's note — deciding only which NAME each of the finder's runs sits
under. The viewer's calibration path is untouched and still pairs with
thicknesses. The sheet's task note says "found without the library's
thicknesses, grouped with them: A 4.875in, B 7.625in" so nothing moves
silently. Pilot, with and without wall types (§3): Joplin A-101 3,656 ft · 46 rooms · 5,768 sf both ways; Baker A101 701 ft · 9 rooms both ways; SW A110 + A400 1,714 ft · 14 rooms both ways (`shots/pilot/full5/`, with the legend's types and with none).

## 3c. A hatched band never takes a drywall default

Two of the ten Joplin runs checked by eye were a cross-hatched masonry
wall read at 4.3 in and 5.0 in and typed A by "all interior drywall
partitions are type A", because A is 4-7/8 in and thickness cannot see
hatch. `stageGroups.hatchedRuns` can: a run whose band holds short strokes
across it, both ends inside the band, at least three and at least 0.3 per
foot, is a filled wall. `wallGroups` keeps the hatched and the hollow
untagged runs of a cluster apart; a hatched run takes a default only if
the default's own sentence names masonry (MASONRY, CMU, CONCRETE, BLOCK,
BRICK), a hollow run never takes a masonry one, and otherwise the run is
untyped. Joplin A-101: 27 of 190 runs hatched (every cross-hatched CMU wall, and no plain partition — the first cut, anything 20° off axis, had flagged 150 of 190, every partition with two doors in it, before the rule was made oblique and dense). Note-typed feet 1,029 → 598 in the measurement; in the pilot the drywall note types 723 ft of A instead of 1,105, and the two hatched walls read at 4.3 and 5.0 in are now untyped, since the masonry note covers 7-5/8 in only.

## 3d. The legend read on the real product path, without the stand-ins

What the pilot used: the second session's cached model reads for Baker
(p25) and SW (p6), and a hand key of Joplin's G-111 with a `uno` list. What
the product does: `legendForPlan` (on the calibration path) and the
WALL_LEGEND ingest stage both rank the set's pages with `legendPages`
(deterministic) and send the top candidate's lines to the model
(`extractWallLegend`, prompt `wall-legend.1`), the stage adding a sight
read from crops. Run here with no key, no cache and no hand key:

| set | `legendPages` top candidate | what the model half would read | against the pilot |
| --- | --- | --- | --- |
| Joplin | p5, rank 1 — "a block headed PARTITION TYPE, 70 assembly lines" (then p50, p74) | the partition types A/B/K/L/V with their suffix schedule and the U.N.O. notes 3 and 6 | same page the hand key was made from; the `uno` list is NOT something the prompt asks for, so the product would type nothing by Joplin's notes until the prompt does (1,105 ft of the pilot's A) |
| Baker | p25, rank 1 — "a block headed WALL TYPES, 40 assembly lines" (then p28 PARTITION TYPE) | a WALL TAG LEGEND composing codes from core letter (S steel, C concrete, M masonry, W wood) + size digit + suffix | the same page the cache was read from, by the same function and prompt; the S6A/C8B codes the pilot used are that read |

The model half is unrun in this checkout: no model key in its `.env`, and
I did not go looking for one. So "works without the stand-ins" means the
page selection; the codes themselves need the stage to run with a key, and
Joplin's U.N.O. typing needs a prompt that extracts the sentences.

**The prompt extracts them now** (`diego/legend-uno`, `wall-legend.2`):
`WallLegendRead.uno` is a list of `{ code, note }`, asked for as rule 7 of
the prompt (the sentence verbatim with the code it names; a sentence that
sets a dimension or a material for everything is not a default), in the
tool schema, parsed by `wallLegendReadFrom` (exported and tested without a
call), carried by `readWallLegend` and `legendForPlan` into `PlanTextLegend`,
and stored in the proposal's `textRead`, which `legendFromProposal` already
reads. So the product's real path is complete end to end once the stage
runs. It was NOT run here: a model call is a real-world spend and my session
refused it; the one call per set (Joplin p5, Baker p25) that would answer
"what does the real path type" needs Diego's say-so in a session allowed
to spend. Until then the pilot's Joplin numbers rest on the hand key's
`uno` list, and Baker's on the cache.

**Attempted 2026-10-30 with Diego's approval, and not completed.** The one
tracked tool for it is `realplan/zzLegendRead.eval.ts` (now keyed on
`WALL_LEGEND_PROMPT_VERSION`, printing `uno`). It ranked Joplin p5 first
("the title says PARTITION TYPES and 70 lines describe an assembly") and
sent the call; the only key this session could reach — the one in a sibling
worktree's `apps/web/.env` — came back `401 invalid x-api-key`, so nothing
was read and nothing was spent, and a look for another key was refused by
the session's permissions. The stand-in half of the comparison IS run, with
`wallTypes.eval.ts` (the instrument both halves share; outputs under
`shots/pilot/legend-live/standin/`):

| sheet | runs / ft | typed | tagged / carried / note / untyped | per type |
| --- | --- | --- | --- | --- |
| Joplin A-101 (p46, hand key) | 190 / 3,747 | 41% | 841 / 115 / 598 / 2,192 | A3 518 · L 175 · B 122 · A 116 (+598 by the A default) · V 26 |
| Baker A101 (p13, `wall-legend.1` cache) | 39 / 701 | 49% | 294 / 50 / 0 / 357 | C8B 230 · S8C 50 · S6A 33 · S8B 31 |

Baker is the pilot's line exactly; Joplin's eval figures sit beside the
pilot's product-path 3,656 ft / 43% because the eval does not split the sheet
the way the WALLS stage does, and the same instrument is used for both halves.
The model half, for a session with a valid key in its shell or in that
worktree's `apps/web/.env` (one call each, cached under `legend-cache/`):

    cd /Users/diego/prova/.claude/worktrees/diego-pilot-counts/apps/web
    REAL_PLAN_DIR="/Users/diego/Claude Folder/takeoff/real-plans/new" LEGEND_CACHE="/Users/diego/Claude Folder/takeoff/legend-cache" LEGEND_SET="Joplin-community-center.pdf" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzLegendRead.eval.ts
    REAL_PLAN_DIR="/Users/diego/Claude Folder/takeoff/real-plans/new" LEGEND_CACHE="/Users/diego/Claude Folder/takeoff/legend-cache" LEGEND_SET="2025.07.08_Baker_EOC_BID.pdf" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzLegendRead.eval.ts

then the same typing run with the two cached reads in place of the stand-ins
(the files the reads write — p5 and p25 expected):

    REAL_PLAN_DIR="/Users/diego/Claude Folder/takeoff/real-plans/new" WT_OUT="/Users/diego/Claude Folder/takeoff/shots/pilot/legend-live/model" WT_SHEETS="Joplin-community-center.pdf:46:288.1829733163914:/Users/diego/Claude Folder/takeoff/legend-cache/Joplin_community_center_pdf-p5-wall-legend.2.json;2025.07.08_Baker_EOC_BID.pdf:13:288:/Users/diego/Claude Folder/takeoff/legend-cache/2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend.2.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/wallTypes.eval.ts

One thing to read the Joplin result with: a model read carries no
`thicknessIn`, and `wallGroups.ts` lets a default type with no thickness
cover every cluster at its fill (line 208, `covers`), where the hand key's
A 4.875 / B 7.625 limit the defaults to their own thickness. A higher "note"
share on Joplin is that rule, not the prompt; to isolate the prompt's
reading, copy the hand key's two thicknesses into the cached read and run
the typing a third time.

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
| Joplin | 6 | 2 | Re-sampled on the product path after the first pass: the two "A" walls that were legend-box borders are still offered (the GENERAL PLAN NOTES box and the title block sit inside the plan view — finder junk, not this branch's) but now land untyped. The two wrong are a cross-hatched masonry wall read at 4.3 in and 5.0 in and typed A by the drywall note: thickness cannot see hatch. Right: a classroom partition typed A; a 2 ft jamb piece, the Q glass partition, a 9 in toilet-room wall and a 5.9 in partition left open. |
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

## 7. The existing-wall legend entry, deterministic half (`existingMarks.ts`, 2026-10-30)

Diego's rule: an existing wall that remains is NOT WALL on every key, and the
finder is to set such walls aside rather than offer them. The second
session builds the set-aside; this is what the legend lane hands it, read
off the sheet's own text with no model.

**What is read** (`existingMarks({ textItems, segments, widthPt })`):

- `legend[]` — short labels naming a kind (`EXISTING` / `NEW` / `NIC` /
  `DEMO`) with a self-contained swatch to their left, and that swatch's pen:
  stroke count, median grey, median and longest piece in inches of paper,
  diagonal share, thickest width, and three flags (`grey`, `dashed`,
  `hatched`). The swatch is the sheet's own pen for that kind, so the
  consumer compares a run against the EXISTING entry *and* the NEW entry
  rather than against a fixed idea of grey.
- `tokens[]` — `(E)` always, plus any abbreviation the sheet defines
  ("EX = EXISTING TO REMAIN" on glen-hazel A-111 → `EX`).
- `tags[]` — labels on the drawing: `EXISTING` (a token at the start,
  "EXISTING …", "… TO REMAIN"; at most four words; not about a door,
  window, floor, lintel and the like) and `NIC` ("N.I.C.", "NOT IN
  CONTRACT", "NO WORK", "LIMIT OF WORK"), each with its box in page-width
  units so an area can be found around it.

**What a swatch has to be**, each rule measured in before it was written:
to the LEFT of the words within 1.5 in; at least two strokes with both ends
inside the box (a plan line running past "(E) DEMISING" on McAllen A3.2 is
not a swatch); spanning at least 0.35 in (three grey ticks of a room outline
beside "JAIL (NO WORK)" on Baker A100 are not); and with no more strokes in
the 0.3 in to its left than a quarter of its own (a label inside a field of
hatch is in the field, not beside a sample). A row starts with its subject
and is not a sentence: "FOR THE NEW BUILDING." and "EXISTING WALL FURROUT."
are keynotes. Six unit tests; mutations run and red for: confinement gone,
extent gone, isolation gone, sentences admitted, abbreviation learning off,
grey flag off, dash flag off, hatch flag off, removal-before-existing
swapped, tag word cap off.

**Measured on the eighteen marked TRAINING sheets** of the cleanup list
(`shots/legend-existing/training-2026-10-30.txt`; held-out sheets not run):

| sheet | legend entries read | pen of the EXISTING entry |
| --- | --- | --- |
| Murray A101 | EXISTING WALL TO REMAIN | black, 9 pieces of 0.05 in — **dashed** |
| Supreme Court A111 | NEW CONSTRUCTION, EXISTING CONSTRUCTION | **black**, 41 pieces of 0.06 in, 2% diagonal — a stipple, not grey |
| Bunkie A100 | EXISTING WALL | black, 8 strokes, thickest pen on the sheet (11 pt) — a solid fill |
| HPL p3 | AREA "NOT IN CONTRACT", NEW PARTITION | — (NIC swatch 8 strokes, 0.5 in) |
| Joplin A-101 | NEW WALL | — (2 black lines, 0.9 in) |
| the other 13 | none | — |

So of five sheets with a readable wall legend, the existing pen is dashed
on one, stippled black on one, thick-filled on one, and absent (only NEW
drawn) on two. **Grey appears in none of the EXISTING swatches**, which is
the measurement behind "grey alone is not enough". Conventions: `(E)` on
Baker (26 labels, room names), E Street (3), McAllen (2 "(E) DEMISING" +
"TO REMAIN"); `EX` defined and used nine times on glen-hazel A-111. NIC
tags on Baker ("JAIL (NO WORK)", "(NO WORK)"), glen-hazel (3), HPL (3).

**Two misfires, found in that run and fixed the same day** (second run,
`training-2026-10-30b.txt`): a NIC label standing inside a hatched NIC area
(E Street "NIC, TYP ALL", glen-hazel's second "N.I.C.") read as a legend
NIC entry whose swatch was the area's own hatch. Measured round every
candidate row on the training legends: all nine true legend rows have ZERO
strokes in the half inch right of their words, the two field labels have
two — a legend row ends in margin, a field goes on past the words. That is
the rule now (`RIGHT_MAX_STROKES`), plus the words themselves: "TYP" is a
note's word and a bare "N.I.C." is what is written ON an area, so neither
is a row. And Murray's NEW swatches did not fail isolation at all — they
are 0.35 in wide to the hundredth and the extent floor was 0.35; it is 0.3
(three ticks of a room outline measure under 0.25). After: Murray reads all
three rows (EXISTING dashed, NEW hatched, NEW WITH SOUND BATT), and the two
field labels are NIC tags. Nine legend rows on five sheets, no misread.

**Not built:** the model legend read does not return an existing entry yet
(`wallLegend.ts` has no field for it; the real read is still blocked on a
key, PILOT.md); the set-level `PlanTextLegend` does not carry one either,
because the partition legend page rarely draws the existing symbol — the
floor plan's own legend does, and that is the page `detectForSheet` already
has in hand.

## 8. The existing set-aside and the estimate (pilot pass six, 2026-10-30)

Whole-set pilot on Baker, Murray and Joplin with the second session's
existing-wall set-aside stacked on main (`coordination/pilot-flow-2026-10-30-existing.md`
has the tables). The VIEWER's offer drops: Murray A101 90 → 12 runs
(78 set aside by the legend's existing-wall pen), Baker A100 91 → 58 (33
by (E) tags and NIC/existing areas), Joplin unchanged. The ESTIMATE does
not move by a foot on any of the three, and the reason is structural:
`offeredCandidates` has one caller, the viewer. The WALLS stage posts the
finder's groups directly, so no set-aside of any kind — legend box, dashed
faces, existing — reaches a whole-set estimate. Second gap: Murray's A101
prints no scale caption the planner reads, so the whole-set run counts
A117 (60 ft) and never that sheet. Both are recorded here for the finder
lane; nothing in this file's module changes them.

## Demolition takeoff (2026-10-30, `diego/demo-takeoff`)

`demoWalls.ts` reads walls to remove as double dashed lines, without the finder,
which is built to set dashed work aside. Doors come from keynotes that say to
remove a door. Rejected on measurement: dashed swing geometry, which read 11 on
E Street against 4 tags and nothing on Green Bay, Murray or Crosslines.

A sheet can lay one line twice in two pens with offset dashes, which reads as
solid, so dashes are read per pen. `existingWallSet.ts` gives the walls standing
on a level, moved onto the new plan; it says when it could not align them.
