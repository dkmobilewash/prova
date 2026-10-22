### Rooms, areas and perimeters from the walls that were found — off until a company turns it on (Diego)
`diego/rooms-areas`

The takeoff could find walls and could not find rooms: the old room finder
rasterised every stroke on the sheet, so a leader cut a room in half and a
parked car was a room, and it was switched off after reporting half a
building. The ring geometry under it was right; what reached it was wrong.

Now the room step is fed WALLS — every long pairing the finder saw, the runs
it kept, and any line drawn by hand — drawn as bands of their own thickness
with door gaps sealed, and the enclosed regions traced into polygons named by
the room tag inside. Measured before it was wired (`lib/takeoff/NOTES-rooms.md`):
on 18 BIM sheets with the model's own walls, 477 rooms at a **1.2% median
area error**, 438 within 5%; on Bunkie A100's six printed rooms, 4 within
5% from the finder's own candidates; Baker A101 7 of 9 within 10%. Where it
fails it says so: a tag in no closed room is listed as "not enclosed", two
tags in one room as "share one room".

What a person sees: with the company switch on (Settings, owner only, off
for everyone until then), **Find the rooms** sits beside Find the walls and
waits for a find; the Rooms panel lists each room's name, number, square feet
and perimeter, lights its polygon on hover, lets the name and number be
corrected, and saves the lot as AREA measurements in one transaction — after
which they are ordinary areas: drag a corner, add a cutout, post to an item.
A room the finder left open is closed by drawing the missing wall with the
Line tool and finding the rooms again.

Migration `20261022000000_rooms_from_walls`, additive: a `ROOM_FINDER`
measurement source, `roomName`/`roomNumber` on the measurement (what the
drawing printed; `label` stays the estimator's), and `Company.roomFinderOn`
defaulting to false. Perimeter is derived from the polygon and never stored.
Applied and read back on a throwaway Postgres only.

Checks: `roomsFromWalls.test.ts` (two rooms, a doorway, a corner door, a tag's
own box), `roomTags.test.ts` (every tag shape the training sets print),
`roomBoundary.test.ts`, `takeoffRoomFinder.test.tsx` (absent with the switch
off, present and waiting with it on), and `e2e/specs/takeoff-rooms.spec.ts`
on the generated S05 — switch off → no button, owner turns it on, walls then
rooms, rename, save, reload. Nothing in the finder's files changed.
