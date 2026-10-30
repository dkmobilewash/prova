### What actually changed, in plain English (Diego)
`diego/existing-walls`

**An existing wall is set aside, not offered as a wall to take off.** The
new-work-only rule (a thick hatched wall counts if it is NEW work, not if it
is existing) now has a product side: `offeredCandidates` sets a run aside
under a new kind, `existing`, with the words on the sheet that said so, when
(1) a tag beside it reads `(E)`, `(E) WALL`, `EXIST. CMU WALL` or `EXISTING
WALL TO REMAIN`; (2) every room it bounds is one the sheet labels `NIC`,
`NOT IN CONTRACT`, `NO WORK THIS AREA`, `EXISTING BUILDING`, `LIMITED SCOPE`
or `(E) OFFICE` — a wall between a marked room and an unmarked one stays
offered, since it may be the new wall that closes the scope off; (3) its
faces carry the pen drawn beside the legend's own EXISTING WALL row — grey
level, line width and dash together, or the FILL's grey when the sample is
a filled band, which is how Murray A101 and Bunkie A100 both draw it — and
only when that pen differs from the NEW WALL swatch's (or, with no such
row, from the pen most of the sheet's walls use). Grey alone never sets a
wall aside. For the fill the stroke reader now keeps the fill colour and
marks the edges of a filled path with it, and the legend is read from the
page's strokes rather than the finder's, which are clipped to the drawing. Layer-named existing
walls (`A-WALL-E`, `A-EXIST`) were already dropped before the pairer; this
is for the flattened plots, which is most of them. Set aside means visible
with its reason and one click to accept, so a sub pricing a remodel loses
nothing. Unit-tested on synthetic sheets, routes separately and through
`offeredCandidates`; `realplan/zzExisting.eval.ts` is the instrument that
scores it against the labels and is keyless-registered. On the training
sheets the routes fire on six of 36 (Baker A100, E Street A2.1, Murray
A101's whole existing building and Supreme Court A111's existing masonry
off their legends' grey poché, NG McAllen A3.2, glen-hazel A-111) and on
the held-out set only by the area route. Measured on the
cleaned keys (snapshot 20261030T1927, 52-sheet sweep vs main, the four
notes-only sheets excluded): training 2,575 ft of junk removed for 69 ft of
real lost, no building worse by more than 38 ft — Murray A101 and Supreme
Court A111's existing buildings off their legends' grey poché, Baker A100's
`(E)` rooms, McAllen's `(E) DEMISING`. Two first-draft routes were measured
wrong and removed: a bare `(E)` (names a door or column as often as a wall)
and an item's `NIC, TYP ALL` read as an area. Held-out delta: real −247 ft,
junk −266 ft, all of it the area route, which on training stands on one
building; the configuration without it costs 38 ft of real for 2,129 of junk
and moves held-out by nothing — so Diego's call was to ship tag and legend
and drop the area route, and the branch does. Details and the per-building
table in `NOTES.md`.

**And a bug the third session found: no set-aside ever reached a whole-set
estimate.** The WALLS stage posted the finder's groups straight from
`detectForSheet`; only the viewer ran `offeredCandidates`, so the legend
box, dashed faces, underlines, schedule rows, site equipment and existing
walls applied to the list on screen and not to the estimate behind it. The
stage now makes the viewer's call and regroups what survives, one
implementation; a test draws a room and a tagged wall through the stage's
own mocks and proves the tagged wall is never posted. On the labelled floor
plans, Joplin's posted feet go 7,346 → 6,131 and Baker's 2,657 → 2,553.
