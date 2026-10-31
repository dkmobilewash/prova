### Two e2e specs red since #809 were stale, not the product (Cyrus)
`fix/starter-wall-types-e2e`

Since #809 the signed-in suite failed `estimating-spine` step 3 (180s
timeout, skipping steps 4-11 and the bid recap with it) and
`takeoff-workspace` step 20 ("the starter library has no W1"). A new company
still gets the starter library: the button works and `wallTypes.test.ts`
pins all ten codes. Two separate spec defects:

- #809 renamed the button from "Start from two common wall types" to "Start
  from the common trade assemblies" and changed its message. A click on a
  name that no longer exists does not fail, it waits — so step 3 used its
  whole budget on one line. The spec now clicks the new label (`exact`) and
  asserts the whole sentence with all ten codes, plus each code on the
  reloaded list.
- `wall-legend-library.spec.ts` shared the TAKEOFF company "because it
  touches only the fixture's codes" — but it writes P1 into the company-wide
  library. `/wall-types` offers the starter button only on an empty library,
  and step 20 seeded only when the picker was empty, so P1 made it skip the
  seeding. The legend spec now uses ROOMS (an existing persona, so no new
  Clerk user on the shared instance), and step 20 checks for W1 itself and
  fails with a sentence if the starter button is missing.

Not run in a browser here (Clerk FAPI is denied in the agent container).
CI's `e2e` job on the PR is where this is proved or not.
