### Doors: an untagged door in a row inside a toilet room is a toilet stall's, and is not posted (Attachment-C 8 false -> 6; no real door lost)
`diego/door-s2`

Diego ruled that toilet-stall doors are not doors: they are Division 10 partitions. After the stall doors left the
keys, the finder still posted them, and Attachment-C's counted 8 false. This is Diego's S2 (2026-11-19). It is a
"not a door" filter in `doorsInScope`, the same place as #1218's counter gate, so the product and the eval drop the
same doors.

A found door is a stall's when all of these hold:
- it is untagged: no mark within 3 ft;
- the nearest toilet label (TOILET, TLT, RESTROOM, UNISEX, MEN, WOMEN, RR) is within 25 ft, and the sight line to it
  crosses no stored wall run 3 in thick or more;
- its own wall is no such run (the room's entry door sits on one);
- its hinge, strike and open end all see the label;
- another such door of its width (within 0.5 ft) stands beside it in a row: within 1.5 widths, parallel within 15
  degrees, within 1 ft of its leaf line.

Measured once on labels-snap-20261119T0700, against main 814082a6:
- **Training:** false 96 -> 94; matched 929 -> 929. No set worse.
- **Retired:** unchanged.
- It drops exactly two doors, both false, both on Attachment-C A1-1.
- **Targets missed:** of its pre-registered targets it reaches Attachment-C 2 of 8, Canton 0 of 2 and Holabird 0 of
  1. This is reported as measured, not tuned.

Checks: four tests. Four mutations, each red: the row-line test, the untagged test, the boundary-wall test and the
sight lines. Two cases first passed for the wrong reason and were rewritten before measuring:
- a partner off the leaf line was being spared by spacing;
- the boundary-wall rule had no case (a double entry on the boundary).
