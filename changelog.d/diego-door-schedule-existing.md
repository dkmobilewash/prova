### Doors: a door whose mark the door schedule lists under an EXISTING section is existing, unless the schedule salvages it (training false 68 -> 66, no real door lost)
`diego/door-schedule-existing`

Sedgwick County Courthouse Annex tags its existing doors E001, E118, E125 and so on. It says nowhere in words that
"E" means existing. It says so by SCHEDULE: p63 holds a "DOOR & FRAME SCHEDULE - EXISTING" listing those marks
beside the new-door schedule. Route 5 only knew a prefix defined in words and a hyphenated mark (E-118), so these
doors were counted.

`existingScheduleMarks` reads every door-schedule page's positioned text. It finds a heading naming an EXISTING
door schedule, takes the marks in its MARK column top-down until a gap of more than half an inch, and drops any mark
whose own remarks say SALVAGE, RELOCATE, REUSE or REINSTALL. Sedgwick's S104-S107 are "SALVAGE DOOR AND HARDWARE"
and keyed: a rehung door is new work. Route 5b then sets aside a found door whose own mark (nearest within 3 ft,
no-hyphen form matched only through this list) is one of those marks. With no EXISTING section, the list is empty
and nothing changes. The eval table and `rooms.ts` share the reader.

The table's stand-in for door-schedule pages also learned the product's line-level title,
"DOOR [AND | & FRAME] SCHEDULE". Its first run was vacuous because "DOOR & FRAME SCHEDULE" never matched; that is
logged.

Measured on labels-snap-20261118T1020 against main 1410fcaa: training false 68 -> 66 (Sedgwick 7 -> 5), retired
unchanged, matched unchanged in both pools. Combined with #1218 (S1) merged in, it is re-measured on this branch
before merge.

Checks: unit tests in `existingDoors.test.ts`. Mutations red: salvage guard off, section gap off, route 5b off. On the
real p63 the reader returns exactly the 23 E-marks.
