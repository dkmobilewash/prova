### A door tagged a bare "EXIST." in its swing is set aside as existing

Garden Square A100 prints its existing doors' marks with "EXIST." under them (102B, 102C), and the doors step counted them as new: route 3 of `existingDoors.ts` knew `(E)` and `EXISTING DOOR`, not the bare word. The bare in-swing test now also takes `EXIST.`, `EXIST` and `EXISTING`, with the same geometry as `(E)` (within a leaf radius of the hinge or strike, on the arc's side of the closed leaf), and the set-aside sentence names the word it found.

Measured alone against the doors precondition reference (main 668d36ba, labels-snap-20261118T1020): training false 92 → 91 (Garden Square 8 → 7), matched unchanged; retired pool identical; no set worse. Check: `existingDoors.test.ts` "a bare EXIST. / EXIST / EXISTING inside the swing" — reverting the regex to `(E)` only reds it.
