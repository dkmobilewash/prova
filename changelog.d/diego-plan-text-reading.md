### Tags read from the symbol they are drawn in, on two real sets that drew them three different ways (Diego)
`diego/plan-text-reading`

The chain legend → tag → run → components → quantities existed and could not
start: Camp Bow Wow matched 7 of 46 legend-coded symbols and ELEVEN03 matched
none, because every one of its 19 wall tags is a split box (`MC` over `1 HR`)
and the detector called every split symbol a detail callout. Measured on the
drawings rather than fixtures, four things the sets do that no fixture did:
each tag is drawn as a diamond, a second diamond and a masking box (and on the
legend sheet the box is inside); the leader ends on a vertex and is emitted
first, so a walk starting on it spent the diamond's strokes and left only the
box; a text item's `y` is its baseline, so a centre taken as `y + height/2`
put `MC` below its own divider; and `WT-12` read as a sheet reference.

After: Camp Bow Wow 16 runs tagged, all by their leader, 333 ft typed where 189
was; ELEVEN03 10 runs and 525 ft where there were none, and its p9 wall
schedule — not the UL table on p96 — completes the chain to studs and track.
The door join places 29 of 30 scheduled rows (11 on a detected gap, 18 on the
nearest run by their mark, reported apart) where it placed 11; the gap
detector missing 17 of the 30 doorways is the finder's ceiling and is recorded
for that lane rather than worked around. Eight of the nine new sets' legends
read for 5–15 cents each, and Central Bank's table-form schedule now yields
studs and board for ten types instead of batts for all ten.

Mutation: 34 mutants over the symbol detector, the tagging, the join, the
assembly parser and the legend finder, each restored by rewriting the file's
own bytes. The numbers are in `lib/takeoff/NOTES.md`.

Second pass, the twelve new sets (twelve architects): the loop walker
followed strokes head to tail and a CAD export emits a diamond's edges in no
particular direction, so Gen BBQ found 0 of its wall tags and STEM 7 of 124
— every stroke now walks either way. A legend's symbol shape is kept only
while it holds a quarter of the coded symbols on the plan (SW legends in
circles and tags in squares: 0 → 21 matched; Camp Bow Wow's pentagon window
marks still lose to its diamonds). A legend code spelled like a sheet
reference (`G4.1`) is still a code, and a `1` in a diamond matches `WALL
TYPE 1` (Murray 0 → 5). A legend drawn as a headed block on a plan or notes
sheet — Bunkie, MHK, Crosslines, one of them headed `Partiton Types` — now
ranks above the mechanical schedule and exterior-detail sheets that merely
say STUD more often, and engineers' M/P/E/S sheets are tried last; all three
read on the first call. And a column-wrapped legend (`3 5/8" 20 GA. MTL.` on
one line, `STUD` on the next) is read as one string, with the studs' own
spacing taken over a track fastener's: 16 of 108 cached types gained a stud
or lost a false flag, none regressed. Thirteen more mutants, all killed.
Eleven door schedules read live and joined: 220 rows, 97 placed — all of
them on Gen BBQ, SLN and SW, most on Baker and E Street, and the misses are
named per set (bare-text marks on MHK and Bunkie, a three-level schedule
against a one-level plan on Central Bank, a page that was not the schedule
on Murray).

Third pass, on the training sets only: the number the plan asks for is the
share of found runs that get a type, and on the final code it is 1–28% per
training sheet (NG Green Bay 25 of 90, Baker 9 of 47, SW 16 of 110, Camp
Bow Wow 16 of 137, down to Bunkie 0 of 55, whose tags are bare text); a run
is a finder segment and a drafter tags a wall once, so that is the honest
ceiling's shape, not a fault in the matching. Fifteen crops spot-checked:
eleven right, two wrong (a leader ending on a junction, a connector that
runs the other way), two ambiguous, and one false positive — a `3'-0"`
dimension box resting on a `2` diamond — now rejected as a dimension. A
stud spacing under a foot (NG Green Bay's `@ 6" O.C.`) is flagged as a
dropped digit rather than doubling a count. Cost per plan set, legend plus
door schedule, 12–26 cents on the training sets. The four held-out sets
were run once at the end and reported apart (STEM 35 of 181 runs typed and
45 → 31 doors, Gen BBQ 6 of 168 and 16 → 16, Central Bank 2 of 102 and
50 → 3, SLN 2 of 93 and 6 → 6), with the caveat that the second pass had
already looked at them. `readWallLegend`, `tagsFromSymbols` and the door
join have no caller outside the evals yet; wiring them is the finder's lane.

Fourth pass, feet against the walls a reviewer accepted: on the thirteen
labelled training sheets, the share of accepted wall FEET that get a type
is 8–90% where the sheet carries tags (SW 318 of 353, NG Green Bay 313 of
536, Camp Bow Wow 413 of 738, Baker 245 of 508, E Street 172 of 477,
ELEVEN03 124–524 of 1,500–1,800 per floor) and zero on the three sheets
whose tags live elsewhere. `typePropagation.ts` carries a tag along a
straight wall of one thickness, past T-junctions and across a door-sized
gap, stopping at a different tag, a turn or a fork; on these sheets, whose
accepted walls already span their openings, it adds 9–26 ft on four of
them and a 12-ft gap allowance was measured carrying a type across an open
passage, so the gap is a double door. No training set has an "all
partitions type X U.N.O." note, so the default tier is 0 ft everywhere and
marked `default` where it ever applies. `bareTextTags.ts` accepts text
that is exactly a legend code or a scheduled mark, outside any symbol and
within 3 ft of a run: Bunkie's walls 0 → 65 ft and its doors 0 → 6 of 11,
MHK's doors 1 → 6 of 31, SW +43 ft; a room-number-as-door-mark tier was
measured, cropped and left out. Held-out sets are closed for this feature.

Brought up to date with `diego/takeoff-audit` by merge (the eval census
kept both sides' entries), and a wiring plan in `NOTES.md` names the
three finder-lane call sites — the `regroup` block in `findWallsOnSheet`,
a legend card from `readWallLegend`, and the door join on `mergeWalls`'
openings — behind one per-company switch, with what the customer sees.

Wired behind `PLAN_TEXT_READ`, off by default: an environment switch
(a per-company key is a Postgres enum value, so a migration), an optional
`planText` input to the finder whose absence leaves the regroup call as it
was, legend and door-schedule reads at calibration-time detection cached
to files, and a panel under the found walls that says where the typed feet
came from, which scheduled doors sit on which group with the schedule's
width, which rows the sheet did not place, and the wall types the legend
defines as quantity-only assemblies with an Add button through the
existing action. With the switch off the finder's result is identical on
all seventeen labelled sheets against the pre-change code, and detection
touches neither reads nor cache. The migration it wants is written in
`NOTES.md`. Not merged.

plan-text-2: the legend read BY SIGHT — the page and one crop per type to
the model, fields back, written as legend lines and parsed by the one
assembly parser. On the three training sets it ran on before the API
credit ran out, it matched the text read's fully-read count (Baker 2 of
8, Bunkie 3 of 5, Crosslines 6 of 7) and added the board to Baker's four
"no assembly" types, flagging the concrete ones; the first run's 8 of 8
was the model reading a stud width out of the code's letters from a crop
that cut off the notes, and is recorded as the reason the crop is wider.
`legendBands` groups runs by agreement with a legend type's nominal
width, and the measurement says not to use it: drawn widths sit one to
two inches off nominal and a band holds runs tagged three types.

Legend by sight ran on all ten training sets under prompt v3 ($1.87):
Baker 2 → 8 of 8 fully read, Camp Bow Wow 3 → 5 of 5, ELEVEN03 0 → 5 of
13, the rest unchanged in count but gaining ratings, heights and the
masonry walls' material; three text-read fields were corrected by the
drawing (a bracing spacing, a two-layer face, a 2 HR rating). E Street's
codes and SW's sheet-wide note are recorded as the two readings not to
trust yet.

Legend by sight v4: a numbered detail's number is its code, a field from a
sheet-wide note is flagged, optional items are listed and never counted,
and a crop is placed by the code's own symbol and assembly words (40 of 65
types' crops on their detail before, 54 after). Eight of ten training
sets re-read; the run stopped on credits before ELEVEN03 and MHK.

The honest test on plan-text v1, once, on Lodi Memorial Library, Missouri
Pavilion and Nall Wealth: legends 6 of 6, 2 of 2 and 11 of 13 types fully
read by sight (the text read had swapped two of Lodi's studs; sight did
not); 117 of 1,317 ft typed on Lodi's plan, 23 of 814 on Missouri's, no
feet on Nall's because its plan carries two scales; doors 0 of 5, 2 of 2
and none placeable. $1.07. Seven failures recorded for v2, the first being
that the floor plan was found by title on one set of three; nothing fixed.
