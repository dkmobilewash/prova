### Close room on SW A110: only real open rooms are badged

The sales floor leaked at its
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
