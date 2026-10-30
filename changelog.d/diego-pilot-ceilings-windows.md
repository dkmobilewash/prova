### Rooms and ceilings ride the whole-set run; a storefront is one window

- The WALLS stage now finds the rooms on every floor plan it counts and
  writes them the way the rooms panel's Save does — an AREA row per room on
  "Rooms" and one on the ceiling family's item when the set's RCPs or finish
  schedules say what the ceiling is (`lib/plan-ingest/rooms.ts`, the shared
  row builder in `lib/takeoff/roomRows.ts`). Gated on **Find the rooms**;
  never twice on a page. The whole-set summary row carries rooms and ceiling
  sf, derived from the rows.
- Window symbols on one wall with no more than a mullion between them are
  one window (`mergeLites`). Joplin A-101 68 → 52, Baker A101 29 → 26, SW
  Grand Junction A110 23 → 21; doors unchanged on the four keyed sheets.
