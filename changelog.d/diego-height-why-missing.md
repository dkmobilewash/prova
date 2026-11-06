### A height the drawings cannot give says why: the legend was not read (Diego)
`diego/height-why-missing`

Chrome on :3010: Baker's wall groups offered only "Ceiling 10'-0"", with no 15'-0" to
deck and no source, though #1003's eval gets Baker right. The local Baker job had no
legend read. Its company never opted into Wall types from the drawings, so the
WALL_LEGEND stage never ran, and a type's height has nothing to come from. (The eval
reads legend reads from disk.)

So Set height on the plan, and the review queue's wall groups, now say so beside the
ceiling: "No height from the drawings: the wall legend has not been read yet. Read the
wall legend" (a link to the plan set), or, with plan reading off, the same plus "Turn
it on (owner)" (a link to Settings → Assistant). The note disappears once the legend
offers a height.
