### When the drawing's name and the measurement disagree, say so (Diego)

`diego/tag-disagrees`

A click-through on School-01 reported the drawing's own tag **`B1` at three
thicknesses at once** — 3-3/8", 6-5/8" and 7-3/8" — and **`EXT-1` at two**. One
assembly is not three thicknesses.

#### The obvious cause was measured and REFUTED

#730 found that one wall drawn with four or five faces was being reported two or
three times, so the natural reading was: same thing again, across the two
detection engines, where `oneWallPerPlace` does not reach — it runs inside
`wallsFromStrokes` and the region engine's output never passes through it.

That is true of the code and **false as an explanation**, and the probe says so:

| fed to `mergeWalls` | out |
| --- | --- |
| one wall found twice, 7-3/8" and 6-5/8", same place | **1** — keeps 7-3/8" |
| the second finding is a short fragment of the first | **1** |
| two real walls 6 ft apart | **2** ✓ |

`mergeWalls` already collapses a wall found twice at different thicknesses,
whichever engine found it. **So the spread is not duplication**, and the fix
that suggested itself would have changed nothing while reading as a cure.

#### What is left is a contradiction between two sources, and both are now on file

Either the tag is on the **wrong run** — `tagByRun` assigns by proximity, and on
a dense sheet the nearest detected run to a label is not always the wall it
names — or the **library's thickness is wrong**. Each needs a different person
doing a different thing, and the app has evidence for neither.

Since #731 both numbers exist, so the disagreement can at least be STATED. A
tagged group whose measured thickness is outside the match tolerance of its own
type's recorded thickness is reported and **not priced**:

> The drawing tags these B1, but they measure 3-3/8" and your B1 is 7-3/8".
> Either the tag belongs to a different wall or the thickness on your B1 is
> wrong — look at this group on the drawing before pricing it.

**This is a correctness fix, not a notice.** Before it, #732 priced that run as
B1 — an assembly twice as thick as the thing that was drawn, on a GC-facing bid,
with the footage looking right.

A type with **no** recorded thickness is exempt. Null means "cannot be matched by
thickness", never "disagrees with everything", and reading it otherwise would
stop a pre-#731 library pricing anything it tagged.

#### Checks

Preflight green, 10,025 tests, no migration. **Five mutations, five red**,
including the two that matter most: a library of nulls reading as all-disagree,
and measurement noise reading as a contradiction.

One existing case changed meaning and was updated rather than deleted: "matches
a tagged group BY NAME, never by thickness" used a deliberately extreme fixture —
a 9" type on a 4-7/8" wall — to prove the tag outranks the measurement. It still
does, and the test now asserts both halves: the type stays `A1`, and the
disagreement is reported rather than priced.

#### What this does not do

It does not say which source is wrong, and it does not resolve the spread. The
one observation that would — whether the B1 groups at two thicknesses sit on the
SAME walls or different ones — needs the real sheet, and is a look rather than a
change.
