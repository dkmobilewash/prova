### Doors: a door-schedule row whose door AND frame both read "(E)" lists an existing door (NG-Lakewood 31 false -> 3; no real door lost)
`diego/door-e1`

Diego's E1, 2026-11-19. NG-Lakewood A9.0 (p11) has no EXISTING section heading. It marks its existing doors in the
schedule rows themselves: 500A reads `3'-0" 7'-0" 1 3/4" (E) (E) (E) (E) (E) (E) (E)`. The shared reader behind
route 5b (`existingScheduleMarks`, used by both the product and the eval) now also lists a mark when, on its own
baseline within 12 in to its right, at least two cells read existing on their own ("(E)", "EXST.", "EXIST.",
"EXISTING"), and nothing on that line says salvage, relocate, reuse or reinstall. A posted door tagged with that
mark is then set aside by route 5b, unchanged. Untagged doors are untouched.

The baseline is read from the PDF's own text items, because the joined-row reader gets both cases wrong:
- it splits NG-Lakewood's "(E)" cells off the mark's row;
- it merges Bluetooth's five "EXST." cells, 5 pt apart, into one string.

Spread, measured before the rule was built: such rows exist on four sets (NG-Lakewood 44, NG-Green-Bay 111A/111B,
UCCS NE180B, Bluetooth 318/319). Not qualifying:
- Canton, where EXISTING is only in a remark;
- Appendix 5B, where EXISTING sits beside SALVAGED;
- Sedgwick's S-marks ("SALVAGE DOOR AND HARDWARE"), so its rehung S219 is untouched.

Measured once on labels-snap-20261119T0700, against main 814082a6:
- **Training:** false 96 -> 68 and matched 929 -> 929. No set worse.
- **Retired:** unchanged (10 false, matched 201).
- **Where it acted:** every door it sets aside is on NG-Lakewood A3.5 (28 more doors, all false). The other three
  sets have no posted door carrying a listed mark on their keyed sheets.

Checks: a unit test and three mutations, each red: the cell minimum lowered to 1, the salvage guard removed, and
the pass removed. The salvage case was first written with cells close enough to merge, and its mutation survived.
It was respaced before measuring.
