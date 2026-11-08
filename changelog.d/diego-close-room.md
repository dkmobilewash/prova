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

**SW A110 (sales areas with no drawn boundary).** The sales floor leaked at its
bottom-left corner, where the west wall stops short of the south wall. I found
the leak by tracing, on the room step's own grid, the shortest path from the
tag to the paper's edge. One Close-room line down that corner closes the floor,
and its dimension strings then divide it: WHOLESALE SALES 102, TINT AREA 103 and
RETAIL SALES 101 come back as named rooms (1,045 / 288 / 1,076 sf).
`takeoff-rooms-real.local.spec.ts` carries this as a known case. Two kinds of
false open room went with it:
- **Notes read as room names.** "A1 ABOVE" glued RETAIL SALES to a note, and
  "EXISTING" was an open room on Baker A101. ABOVE, BELOW, EXISTING and MARK
  are no longer room names.
- **Schedule text.** A tag counts as an open room only when it sits in the region
  that reaches the outside (`leaks`). The hardware schedule's text, in small
  closed cells, had given thirteen "open rooms".
