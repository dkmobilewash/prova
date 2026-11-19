### An enlarged plan prices no wall LF in the eval

Diego's ruling (BOARD.md 2026-11-19): a wall is priced once, from the main floor plan. The new
`ENLARGED_PLAN_SHEETS` list in `heldOutSets.ts` names sheets whose keyed walls sit on enlarged
views of rooms that also appear on a keyed main plan, and the zero-touch eval zeroes their WALL
and BOARD terms the way it already does for a sheet whose wall review never ran — doors,
windows, types and heights still count, and the run prints a named ENLARGED PLAN exclusion line
per sheet. Confirmed members: Joplin A-111 (631 LF) and Camp Bow Wow A103/A104/A120 (~175 LF).
Deliberately NOT members, and pinned as tests: area plans that carry the word ENLARGED but ARE
the set's pricing plans (Mid-City A4.0-A4.3 "ENLARGED BLDG AREA", K-4 A3.10 "AREA A"), and main
plans whose notes merely say "SEE ENLARGED PLANS" (SW A110 and friends). The check for the
trap: before adding a sheet here, ask whether any OTHER keyed sheet prices the same rooms — an
area plan with no parent is a main plan, whatever its caption says.
