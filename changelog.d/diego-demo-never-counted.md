### A demolition plan is never a level's counted floor plan (Diego)
`diego/demo-never-counted`

Chrome's re-test on E Street: A2.1, the new floor plan, read "not counted: A1.1
shows the same level", and A1.1, the demolition plan, was counted with 40
runs. The whole-set planner asked "does this sheet already have walls?" before
"is it a floor plan of the work?", so A1.1, once it had walls, joined A2.1's
level and won it for having them.

What the sheet is now comes first: a sheet the verdict skips (a demolition plan,
a ceiling plan, a roof plan…) is "not a floor plan" whether or not walls were
found on it, and the new plan is the level's counted one. Plan comparison still
reads the demolition plan to set existing walls aside, which is all it is for.

- `eStreetPairing.dbtest.ts`, on the real set: with A1.1's walls on the job,
  A2.1 is counted and A1.1 is "not a floor plan". Red on main's order.
- Not changed: A1.2 "SLAB EXISTING CONDITION PLAN" still reads as a plan to
  count; the verdict does not know "EXISTING CONDITION" titles.
