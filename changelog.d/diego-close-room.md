### Close room: the estimator closes a room the walls left open, and gets its area

A ceiling contractor needs every room's area, and a room tag that lands on no
closed region (a wide opening, a missing wall, a cased opening the door seals
don't bridge) had no area at all. The panel listed such rooms as "Not enclosed"
and told the estimator to draw a line with the Line tool, which did close the
room, but measured a line that then sat under Unassigned waiting to be moved
onto a priced item.

- On the drawing, each such tag now shows an amber **open room · NAME** badge,
  and the rooms panel counts them ("2 open rooms: …").
- **Close room** (in the tool menu): drag a straight line across the open side.
  Each end snaps to the nearest wall end within 12 screen pixels. The room step
  runs again at once, and the room appears with its area and perimeter.
- The line is saved with the job as a line measurement labelled
  `Room boundary` (`ROOM_BOUNDARY_LABEL`) with no item. No migration is needed;
  `roomBoundary` already read hand-drawn lines as walls. Undo deletes it and
  the room opens again; Redo draws it again.
- Boundary lines are left out of the Unassigned count and its "Move N on this
  sheet to …" offer, so a boundary can't end up in a bid.
- A line that closes nothing is kept, since a room open on two sides needs two
  lines, and the screen says so.

Specs: `takeoff-rooms.spec.ts` closes S05's garage (its 16-ft overhead door)
and undoes it in CI; `takeoff-rooms-real.local.spec.ts` closes Baker A101's
open rooms locally.
