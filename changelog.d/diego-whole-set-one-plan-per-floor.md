### The whole-set run counted one floor ten times; now one plan per floor, architectural only, and the estimate refuses the second copy (Diego)
`diego/whole-set-one-plan-per-floor`

Measured 2026-10-29 by running two training sets through the product's own
actions (`coordination/pilot-flow-2026-10-29.md`): the one-press walls run
measured the architectural background on every discipline's sheet —
mechanical, plumbing, electrical, structural, code, FFE and finish plans,
elevations, a demolition plan — and the estimate added them all. Joplin
posted 37,647 ft against about 3,600 on its floor plan; Baker 22,098 against
about 1,750. Three things, each with its test:

- **Architectural floor plans only.** `takeoffRank` refuses any sheet whose
  number's letter prefix is not an A-series (`disciplineFromNumber`: M, P, E,
  ED/EL/EP, FP/FA, T, S, C, L, G, D, AD, AS…), whatever its title says —
  "LEVEL 1 PLAN" on EP1.01 is a power plan. The title words the pilot showed
  missing join the refusals: CODE, LIFE SAFETY, FF&E, CEILING PLAN, FIRE
  PROTECTION, DEMOLITION.
- **One plan per floor.** `wallsPlan` plans the run for the SET: eligible
  sheets are grouped by the level their title names (a set that names none
  is one floor), one is kept per level — walls already found, else the
  OVERALL plan, else a plan that is not ENLARGED, else the lowest number —
  and the rest are listed in the summary as `same level as A100` and never
  measured.
- **The estimate guard.** `postTakeoffMeasurements` reads the sheets behind
  the measurements off the plan's index, refuses two that show one level
  with both names (nothing added), and the run's label carries the sheets
  that fed it: `Pilot walls — from A100, A102`.

PILOT_RESULT
