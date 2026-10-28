### A drawing keeps the cells of its own region (Diego)
`diego/view-losses`

Bunkie A104 draws the same warehouse twice, a dimension plan and a floor
plan a gutter apart, and captions the floor plan under the middle of its
drawing. The region placement handed every cell left of that caption
across the gutter to the dimension plan, so the floor plan measured 147 ft
against the dimension plan's 459, and the floor plan is the one the sheet
keeps. Now a cell goes to a caption inside its own region before any
other; an orphan region still joins the nearest caption anywhere. Sweep
of all 36 labelled sheets before and after: Bunkie A104 147→195 ft, Albany
A-100 (held-out, delta only) loses 243 ft of extra and no key, nothing
else moves. The other three "losses" the sweep named are not losses — HPL
p3 was three copies of one tier's walls, Camp Bow Wow A120 was eight
elevations, Bunkie A100 measures its plan in full with views=0 — and are
explained in `lib/takeoff/NOTES.md`.
