### Existing doors are set aside, like existing walls, with an Undo (Diego)
`diego/existing-doors`

The UCCS A2.1.2 audit (Round 22b) found 19 of its 23 "false" found doors were real doors in the building
that stays: the existing restrooms (N141 (E), N142 (E)) inside a dashed boundary, two (E) corridor doors,
and a door along the hatched existing-scope edge. They outscored every new door, so no door line could
reach 97%. Walls had an existing set-aside; found doors had none. Now (`existingDoors.ts`, Diego's four
rules) a found door is set aside, never dropped, when it:
- sits on a wall already set aside as existing;
- is inside a hatched area or a closed dashed box labelled existing or not in contract;
- has a tag carrying (E): a mark like `N141 (E)` beside it, or a bare `(E)` inside its swing;
- matches a door the paired demolition plan keeps.

A bare `(E)` across the wall from the swing does not count: E Street A2.1 prints it under the dimension
of its new doors E-9 to E-11, and the first cut of the rule lost those four. Every door path uses
it (the viewer's Run takeoff, the whole-set rooms step, the training rows); the panel bar says how many
doors were set aside and why, and Undo counts them on that sheet (stored per page, no migration).

Training (Round 22b labels): 16 false doors removed (UCCS 10, Macon-Bibb 5, Baker 1), 0 real doors
lost. Check: `existingDoors.test.ts` (12 cases, 12 mutations red), the demolition plan's kept doors in
`priorPlan.test.ts`, the bar's line and Undo, and a census that every product door path passes the
evidence.
