### A wall group takes its plan's building part's height; a variant tag gets its family's zones (Diego)
`diego/heights-by-building`

**Bunkie: one height per building part, pre-filled from the plan.** Bunkie's sections print
"T.O. WALL 10'-0"" for the main building and the addition and "T.O. WALL 2 14'-4"" for the
new warehouses. The queue offered both as choices. Now:
- the legend's height read records, for a type with one height per part, the height each
  building a plan names takes, with its source ("Height for WAREHOUSE 14.333 ft: A313 …");
- detection stores which building a sheet's plan caption names (A100: "FLOOR PLAN -
  INVESTIGATIVE SERVICES ADDITION" → ADDITION);
- the queue pre-fills a group on that sheet with that part's height, citing the section,
  and its label says the part. Both heights stay offered as choices.

**Joplin: a variant tag gets its family's zone choices.** Joplin tags A3 and B1, variants of
the legend's A and B (`familyOf`). Heights and zone choices are kept under the legend's
codes, so an A3 group was offered none. Lookups now fall back to the family: the type's
height, the zone choices, and the level height.

**Measured.** Both are product changes the eval already made: its sheet line resolved
Bunkie per building, and its scorer looked variants up by family. So training (43.0%
correct / 0 wrong / 54.5% no height) and held-out (1.3 / 5.9 / 91.0) are unchanged by
construction, and held-out was not re-run on unchanged scoring code. Bunkie's typed walls
on A100 all sit in E rooms (the sheet carries no K room), so 10'-0" is right for every one.
The key gives Bunkie's zones by room, so the scorer counts them as lenient (42.0%), not correct.

**What remains on training heights is not a height read:** Joplin's zones (about 1,440 ft,
a choice by design), Bunkie's untyped EXT (93 ft: no type, so no building height), and a
Green Bay A3.1 wall the finder never found (76 ft).
