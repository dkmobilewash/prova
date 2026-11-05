### On a renovation, a wall the demolition plan also draws is existing, not new work — behind a company switch that starts off

On a renovation set the finder offers the existing building's walls as if they were new work.
The set already says which walls are existing: the same level's demolition plan draws them,
and marks the ones it removes. This compares the two.

- **Pairing:** each new floor plan is paired with its level's demolition plan by sheet number
  (D100 with A100, AD101 with A101), else by title (AD1.0 with the one floor plan). When the
  titles cannot tell two plans apart it does not guess. The pairing is derived every load from
  the sheet numbers and titles the inventory read, and never stored.
- **Same-layout check:** when walls are found, the demolition plan is read from the same
  document, its removed walls taken out, and aligned to the new plan. If fewer than 5 walls
  agree it is not the same layout, nothing is set aside, and the sheet says so.
- **The rule:** on a paired sheet that lines up, a wall the demolition plan also draws (and
  does not remove) is set aside as existing to remain, by name: "also drawn on AD101, this
  level's demolition plan".
- **On the sheet:** the takeoff shows which demolition plan the sheet is compared with and how
  it was chosen, what it set aside or why it set nothing aside, and lets the estimator pick
  another sheet, remove the pairing, or go back to the automatic one. Only that choice is
  stored (`TakeoffPlanPage.priorPage`, `priorPageChoice`).
- **The switch:** `Company.planCompareOn`, Settings → Estimating, owner only, default OFF.
  Nothing changes for any company until its owner turns it on. With it off, the comparison
  code is not even loaded.

Measured as the app runs it (text pairing plus the layout check) on round 11's labels
(`labels-snap-r11-20261104T222119Z`):
- **Training:** 2,738 ft of junk set aside for 84 ft of real wall, 32.7 : 1. The worst building
  is Clerk of Courts at −43 ft. Renovation posted vs key goes from +260.1% to +186.2%. New
  build is untouched.
- **Held-out, renovation:** 6,838 ft of junk for 200 ft of real wall. Posted +203.1% → +101.8%.
- **Not paired by text:** Baker and Bunkie pair only by their drawings in the eval, so the
  estimator pairs them by hand on the sheet.

Migration `20261105000000_plan_compare` is additive: one boolean defaulting false and two
nullable columns. It was rehearsed on a populated local copy.
