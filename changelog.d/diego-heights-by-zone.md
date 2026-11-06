### A wall's height follows its plan's level; heights by part of the building are a choice (Diego)
`diego/heights-by-zone`

Diego, 2026-11-05: **by level is automatic, by zone is a suggestion.**

**By level.** A multi-storey set marks its levels on the sections ("2nd Floor
763'-8"", … "Roof Plan 832'-4""), and each floor plan names its level in its
caption, two to a sheet where there are two (Crosslines A100: "1st Floor Plan",
"2nd - 9th Floor Plan"). Each wall takes the level of the drawing it sits in: walls
are joined into drawings and each drawing takes the caption under it, not the one
above (A100 stacks the roof, floors 2–9 and the 1st floor). A type that runs to
the structure then takes that level's floor-to-floor: 9'-8" on the 1st floor and
8'-7" on 2–9, with the two markers it came from. In the review queue, a group on
two levels becomes one item per level with its height pre-filled. Confirming puts
each level in its own item ("A walls · levels 2–9"), so two floor-to-floors can
both be priced.

The level markers are kept when a legend type's height is read (the set is walked
then anyway) and each sheet's captions when walls are detected, so the queue never
opens the PDF.

**By zone.** Within one level, Joplin's sections print 12'-0" lower roofs, 12'-4"
admin and 16'-8" central. Nothing on a plan says which wall is under which roof,
so these are now buttons beside the height in the queue, each showing what printed
it. Z steps through them, and the estimator picks per group.

| ROUND 14 key | correct | correct + lenient | wrong |
| --- | --- | --- | --- |
| training (9 sheets), before | 30.0% | 32.4% | 0 |
| training, after | 30.0% | 32.4% | 0 |

Training cannot move: the key leaves Crosslines unscored (floor-to-floor less a
slab it doesn't state), and every other training set is single-storey. The figures
were checked against the key's own note instead: 9'-8" and 8'-7", both exact.
