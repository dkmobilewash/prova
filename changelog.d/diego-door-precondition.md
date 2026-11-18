### Doors: a copy in a finish, lighting or demolition view, a grey door in a grey wall, and a door inside the N.I.C. grey are not counted (retired-pool false doors 32 -> 14, training 27 -> 10, no real door lost)
`diego/door-precondition`

Diego's precondition for the fresh doors exam is training >= 97% (pooled and every finished set) and the retired
Round-23 pool >= 95%. On labels-snap-20261118T0512 at main e45e4290 the retired pool stood at 85.1% (215 posts,
32 false) and training at 94.3% (472 posts, 27 false). Three causes, each measured alone under the pre-registered
rule (pooled false down, matched not down, no set worse), all on the frozen snapshot:

- **A door copied into another view of the same plan** (`copiedIntoOtherViews`, `doorsWindows.ts`). HPL I-110
  draws one unit three times at 1/4" (finish, decorative lighting, partition), and Kirkland df9e0224 A100 draws its
  demolition floor plan above its floor plan. A door goes when another door matches it under a translation that 3 or more
  door pairs share, its own view's title names a non-door view (FINISH, LIGHTING, DEMOLITION and similar), and
  the copy stands in a view that does not. Training false 27 -> 10 (HPL 25 -> 8), retired 32 -> 29.
- **A grey door in a grey wall** (route 6b, `jambPen`, `existingDoors.ts`). Kirkland draws its existing doors and
  walls grey, but most of its doors are existing, so route 6's "most doors dark" never held. On a renovation sheet
  where some door is drawn dark, a grey door whose jambs are grey is set aside. Retired 29 -> 21; training untouched.
- **A door well inside the grey the sheet calls not in contract** (route 7, `nicGround`). Fills are now numbered in
  paint order (`StrokeSegment.path`, carried by `inPageWidthUnits`), so the visible ground at a point is the
  last-painted fill containing it. NW C35NW draws one grey rectangle under the building and paints new work white
  over it. The N.I.C. grey is a swatch whose label beside it on the same line says N.I.C. / NOT IN CONTRACT / NOT IN
  SCOPE, or the ground under such a phrase in the plan. A door goes only when 8 points on a ring 1.5 leaf widths round
  it all stand on that grey. Retired 21 -> 14 (NW 10 -> 3); training untouched.

Two earlier versions of the N.I.C. rule each removed a real door (HPL's door into the N.I.C. area, Appendix 5B's 421
beside the stair tone). That is why the ring tests a door's whole surroundings, and why it does not depend on which
leaf the finder took for the closed one.

Cumulative, matched key doors unchanged in both pools: retired 85.1% -> 92.9%, training 94.3% -> 97.8%. The
precondition still fails: the retired pool is short of 95%, and HPL I-110 (38.5%) and Bluetooth AI101 (95.7%) are
below 97%. Four of HPL's eight remaining falses are a queued key question (existing vs new doors in the partition
plan). Measured and NOT shipped, all in coordination/log.md: a concentric-arc curved-wall rule (both versions lost
real doors) and a legend "DOOR" label rule (lost 4 real doors).

Checks: unit tests in `existingDoors.test.ts` for each rule. Mutations red: paint order reversed, ring at 0.5
leaves, the counted-view guard dropped, the jamb test dropped. `strokeFieldsCensus` covers the new `path` field.
