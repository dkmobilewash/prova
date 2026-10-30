### The plain floor plan over the OVERALL one; ceilings off an aligned RCP's hatch; no 89-ft windows

- The whole-set planner keeps a level's plain floor plan over its OVERALL
  plan when both exist. Baker's A100 "OVERALL FLOOR PLAN" drew the existing
  building with the new block (1,781 ft, 45 doors, "(E)" rooms, "JAIL (NO
  WORK)"); A101 "FLOOR PLAN" is the new work — 732 ft, 20 doors against 20
  keyed. Alone, an overall plan is still the floor (Joplin).
- `ceilingsForRooms` reads a ceiling plan drawn over the same footprint
  (`alignCeilingPage`: half its room tags inside the floor plan's rooms after
  at most one shift): an untagged floor room takes the ceiling tag the RCP
  printed inside it, and a room whose tag is only a height takes the family
  the hatch says, read from the RCP's strokes — which the whole-set run now
  hands over (`lib/plan-ingest/rooms.ts`). Joplin A-101: 5 → 41 of 47 rooms
  with a ceiling, 768 → 6,349 sf. Baker's RCP redraws the new block elsewhere
  with tags on leaders and is rightly not aligned; it joins by name on A101.
- `mergeLites` refuses a join wider than `WIDEST_WINDOW_FEET`: Joplin's
  resident-room wall had become one 89-ft window.
