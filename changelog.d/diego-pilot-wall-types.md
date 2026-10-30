### Walls onto the estimate by type: carried round corners, the legend's U.N.O., and an item per wall type

- `typePropagation` carries a tag round a corner when the corner is the only
  way on: a same-thickness run whose end meets the walked endpoint with
  nothing else meeting it. Carried feet on NG Green Bay A3.2 36 → 47% of
  the sheet; conflicts stay zero on every training sheet.
- The partition legend's own "unless noted otherwise" sentence rides on the
  type (`MatchableWallType.unoNote`, from the stored legend read's `uno`
  list) and is the fallback where the floor plan has no note; each default
  covers its own thickness only, and a thickness two types share stays a
  question. Joplin A-101 0 → 1,029 ft typed by its G-111 notes.
- A split symbol with a sheet number in one half is a detail callout, never
  a tag, and so is loose text inside a rejected symbol or beside a sheet
  number: Joplin's "A3 / A-621" and "B4/ A-621" no longer type 200 ft of wall.
- The whole-set WALLS stage writes each sheet's groups onto a takeoff item
  per wall type (`lib/plan-ingest/wallItems.ts`; label says tag, carried,
  U.N.O. or by thickness; the rest on "Walls — untyped"), so Send to estimate
  prices each type with its own assembly. The sheet's note names the
  thicknesses the finder paired with, since a library with thicknesses
  finds different walls from one without. `wallTypes.eval.ts` reports feet
  typed per sheet and per type.
