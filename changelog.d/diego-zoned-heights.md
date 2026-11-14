### Zoned heights, wall by wall: the zone keys read, the product's side probe shared, and an eval that scores each wall against its own room's zone (Diego)
`diego/zoned-heights`

Joplin's walls run to the structure of the roof over them (12'-0" / 12'-4" / 16'-8"), Bunkie's to
its building's, and SW's to its area's ceiling. One height per type cannot score them, and the
height-chain instrument ran with no rooms, so on Joplin it fell to the 10 ft fallback for every wall.
Chrome has now keyed all three sets room by room (Round 24).

- **`roomZoneKey.ts`** reads the three zone keys the same way: room number → zone → height.
  Joplin's parts take their heights from the heights key, and a "can't tell" room is left out.
  `wallKeyHeight` gives a wall a key height only when its keyed rooms agree. `keyTypeFor` moved
  here from `zzHeightsByCode`.
- **`wallSides.ts`** is the product's own side probe (`assignWallHeights`), now one function that
  the product and the height evals share. Product behaviour is unchanged.
- **`zzZonedHeights.eval.ts`** scores each zoned-type wall: its rooms, its key height from those
  rooms' zone, and the product chain's height through those rooms (ceilings, the roof over each).

First rows (training, after Round 24):
- **Joplin.** 1,222 of its 1,542 zoned ft are scorable. With rooms, the chain is right on 1,113 ft
  and wrong on 109; the wrong 109 ft are ADMIN rooms whose roof the roof-plan read calls pitched.
  208 ft have no room on either side.
- **Bunkie.** 204 ft, all right.
- **SW.** Only 17 of 102 ft get a room, because its open sales areas do not close as rooms.

No product output changes. The heights fix (b) is measured on these rows, behind its own gate.

The check: `roomZoneKey.test.ts` (each key's row shapes, height-less zones, walls between zones;
the real keys whole with ZONE_KEY_DIR) and `wallSides.test.ts` (the probe, and that the product and
the eval both call it).
