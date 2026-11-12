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
3. **The company's default wall height**, asked at the trade pick (10'-0" preset), and changeable on
   Settings. Such a height is **assumed**: the estimate line says "(height assumed: check)", and bid check
   says "N walls use your default height (10 ft), not one read from the drawing: confirm".

A wall's own height prices its board only when its item has none; a typed or answered height always
wins. Measured against heights keys r14–r16 on labelled walls (`zzHeightsByCode.eval.ts`):

- Training: the printed rule covers 85.6% of wall footage, 92.7% right and 3.6% wrong. Board gap at
  zero-touch's $2.20/SF: $190,518 → $7,250.
- Held-out, once: no set prints a rule the code reads, so every wall takes the default. Board gap:
  $457,660 → $70,381, mostly under; the walls are taller than 10 ft.

Migration `20261113010000_wall_heights_by_code` (additive). Tests: `lib/takeoff/heightsByCode.test.ts`,
`lib/takeoff/wallHeightsAssign.dbtest.ts`.
