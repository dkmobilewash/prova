### Every wall a height: what the drawing prints, else your default, marked assumed (Diego)
`diego/heights-by-code`

With no presses a wall had no height, so the bid carried no board for it. The biggest zero-touch
dollar cause: about $181k of held-out board. Each wall now gets a height when the whole-set run finds
its rooms (`lib/takeoff/heightsByCode.ts`, by code, no model), and the height carries its source:

1. **What the drawing prints:** "all walls to deck" with one structure elevation; "N" above the highest
   adjacent ceiling" (the room's ceiling, else the set's one ceiling); "all studs … to the ceiling
   structure" under several roofs (the roof the wall's rooms sit under).
2. The room's ceiling or the floor-to-floor was measured and **not shipped**: 98.6% and 28.7% wrong on
   held-out, where walls run past the ceiling to the structure.
3. **The company's own answer, ASSUMED.** "Your interior partitions usually go": to deck/structure
   (the floor-to-floor, else the set's one structure elevation), to the ceiling + 6", or a fixed height.
   The first two fall back to the fixed height. It's asked at the trade pick, preset by trade (to
   structure and 10'-0", chosen on training), and changeable on Settings, where a change re-prices the
   open estimates' assumed walls. Such a height says "(height assumed: check)" on the estimate line, and
   bid check says "N walls use your assumed height, not one read from the drawing: confirm".

A wall's own height prices its board only when its item has none; a typed or answered height always
wins. Measured against heights keys r14–r16 on labelled walls (`zzHeightsByCode.eval.ts`):

- Training: the printed rule covers 85.6% of wall footage, 92.7% right and 3.6% wrong. The level-3
  conventions: to structure and fixed 10 ft tie at 88.0% close; ceiling +6" is 87.5%. Board $ error at
  zero-touch's $2.20/SF: $190,518 → $7,250.
- Held-out, once: no set prints a rule the code reads, so every wall is assumed. 7.9% close; board $
  error $457,660 → $76,816, mostly under. Fixed 10 ft alone would have been $70,381: the floor-to-floor
  runs high there.

Migration `20261113010000_wall_heights_by_code` (additive). Tests: `lib/takeoff/heightsByCode.test.ts`,
`lib/takeoff/wallHeightsAssign.dbtest.ts`.
