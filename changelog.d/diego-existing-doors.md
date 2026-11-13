### Existing doors are set aside, like existing walls, with an Undo (Diego)
`diego/existing-doors`

The UCCS A2.1.2 audit (Round 22b) found 19 of its 23 "false" found doors were real doors in the building
that stays: the existing restrooms (N141 (E), N142 (E)) inside a dashed boundary, two (E) corridor doors,
and a door along the hatched existing-scope edge. They outscored every new door, so no door line could
reach 97%. Walls had an existing set-aside; found doors had none. Now (`existingDoors.ts`, Diego's four
rules) a found door is set aside, never dropped, when it:
- sits on a wall the sheet's own marks set aside as existing (a tag, the legend's pen, grey, a NIC hatch),
  never a wall plan comparison set aside: there the demolition plan decides the doors too;
- is inside a hatched area or a closed dashed box labelled existing or not in contract;
- has a tag carrying (E): a mark like `N141 (E)` beside it, or a bare `(E)` inside its swing;
- matches a door the paired demolition plan keeps.

A bare `(E)` across the wall from the swing is the dimension's, not the door's tag, so it does not
count (E Street A2.1 prints it under the openings of doors E-9 to E-11). Those doors are existing: the
paired demolition plan keys them C11.04, "existing wood door to remain", and on a paired sheet the
demolition-plan rule sets them aside. E Street's key counts 13 of them as real doors, which is a key
correction for Round 22c, not a loss. The first cut also set aside every door on a wall plan comparison
set aside, and lost E Street's new doors 1 and 6, cut into kept walls (the original's audit; the
demolition plan draws no door within 7 ft of either). Rule 1 now reads only the walls the sheet's own
marks set aside. Every door path uses
it (the viewer's Run takeoff, the whole-set rooms step, the training rows); the panel bar says how many
doors were set aside and why, and Undo counts them on that sheet (stored per page, no migration).

Training (Round 22b labels, without plan comparison, as the table is built): 16 false doors removed
(UCCS 10, Macon-Bibb 5, Baker 1), 0 key doors lost. With plan comparison (the table's new `OFT_PAIRS`),
E Street A2.1 sets aside exactly its 13 E-numbered doors, all by the demolition plan; doors 1 and 6
stay. The first cut set aside 15 there, and the table's loss count now shows both. Check: `existingDoors.test.ts` (12 cases, 12 mutations red), the demolition plan's kept doors in
`priorPlan.test.ts`, the bar's line and Undo, and a census that every product door path passes the
evidence.
