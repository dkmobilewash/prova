### Takeoff becomes a recipe engine — paint, flooring and fixture counts join walls and ceilings (Diego)
`diego/takeoff-recipes`

The only takeoff arithmetic in the product was two hardcoded functions for
walls and ceilings. Every other scope a specialty sub bids — paint, flooring,
fixture counts, and later EIFS, insulation, masonry — would have needed its
own new function, which is how "takeoff" becomes a pile of special cases.

`lib/takeoff-recipes.ts` turns the three measurement primitives (linear feet,
square feet, counts) into unpriced line items through a per-trade recipe, so
adding a scope is adding a recipe — a data definition — not a code path. The
starter library covers drywall walls/ceilings (delegating to the existing
`lib/takeoff.ts` arithmetic, so a bid's numbers are still computed in one
place), paint (gallons from coverage), flooring (area + waste + trim), and
fixture counts. Quantities are recomputed server-side from the raw
measurements, never trusted from the client; the on-screen preview runs the
same pure `recipeLines`, so what you see before saving is what is saved.

The check: `lib/takeoff-recipes.test.ts` pins each recipe's output for known
inputs, and `lib/action-capability-guards.test.ts` executes the new
`addTakeoffLines` action as a principal without VIEW_JOB_COSTS and asserts it
refuses before touching the database.
