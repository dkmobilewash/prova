### A wall tag's own name says which run it means (Diego)

`diego/tag-knows-its-thickness`

`tagByRun` assigned a drawing's wall tags by proximity alone. Where two walls
run side by side that picks the wrong one, and School-01's A-101 has three such
cases — measured by replaying the real chain against the real file, with the
distances the code itself computes:

| tag | won | lost |
| --- | --- | --- |
| `EXT-1` at (0.805, 0.282) | 4-7/8" at **0.47 ft** | 8-7/8" at 2.32 ft |
| `B1` at (0.641, 0.203) | 6-3/4" at **1.21 ft** | 7-1/4" at 5.84 ft |
| `B1` at (0.656, 0.196) | *dropped on the clear margin* | 7-1/4" at **1.71 ft**, the nearest |

In every one the company HAS a wall type of that exact name, with a thickness,
and exactly one candidate matches it. The drawing was not being ambiguous — the
reader was throwing away the half of the evidence that settles it.

#### The name narrows the field, then distance decides

`tagByRun` takes the wall types and prefers runs whose thickness fits the type
its tag names. It **narrows, it never reaches**: a fitting run still has to be
within `TAG_REACH_FEET` and still has to beat its rivals by `TAG_CLEAR_MARGIN`,
measured among the fitting runs — a neighbour the name rules out is no longer a
rival. Name matching goes through `sameDesignation`, so `EXT 2` on the drawing
finds `EXT-2` in the library.

All three cases above now resolve to the right run.

#### The regression this shipped first, caught by its own probe

The first draft asked "does a fitting run exist" **anywhere on the sheet**
rather than **within reach**. That dropped four tags that were already right.

The perimeter EXT tags are the reason it matters. The plan draws EXT-1 as
**6-5/8"** — 6" stud + 5/8" gyp — while the schedule totals **8-7/8"** with
sheathing, EPS and EIFS; EXT-2 is 6-5/8" drawn against 8-1/8" scheduled, the
difference being sheathing and 3-coat stucco. Both exterior types share the
same framed core, which is exactly why both measure 6-5/8". The only 8-7/8" run
on the sheet is 4 ft long and most of a building away, so "a fitting run
exists" was true and useless, and the tag fell back to nothing.

**That deleted the drawing-vs-schedule disagreement from the screen** — the one
thing on this sheet an estimator most needs to see, because the sheathing and
cladding are real scope the line work does not show. The fix falls back to the
nearest run of any thickness when nothing fitting is in REACH, so those tags
keep their walls and keep saying they disagree.

#### Checks

Preflight green, 10,062 tests, no migration. **Six mutations, six red** —
including the name no longer narrowing, the reach regression above, the margin
being skipped, string equality replacing `sameDesignation`, and the viewer
quietly dropping the new argument (which compiles, passes every tagger unit
test, and silently restores nearest-wins — blind until a call-site census
covered it).

A seventh was attempted and is **recorded as not-a-mutation**: with a type that
has no thickness, `[]` and `walls` both route to the same fallback, so that
branch is behaviourally inert either way and there is nothing for a test to
catch.
