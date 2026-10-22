### Takeoff: what is measured reaches the estimate (behind the existing switches, OFF)

Four gaps from the 2026-10-22 audit of Baker's takeoff, each the smallest
fix that closes it:

- **Legend heights reach the library.** Adding a wall type from the legend
  now reads the type's height off the set — the legend's own words, the
  sections' deck elevations, the ceiling plans' A.F.F. tags, the lettered
  and general notes — and writes `defaultHeightFt` with the chain and its
  confidence in the type's notes. A height that rests on a sheet-wide note
  alone is written LOW and says "check the sheet"; a type whose words
  resolve to no printed figure gets no height and a note saying why. The
  review row's message says what was read. (`lib/takeoff/setHeightFacts.ts`)
- **The sheet's U.N.O. type is offered, not applied.** An untagged wall
  group under "ALL PARTITIONS TYPE A1 U.N.O." used to be priced as A1 with
  nothing to click. Now A1 leads the group's picker, marked as the sheet's
  note, and the group is priced only once the estimator picks it.
- **Rooms land in items.** Saving the rooms puts every room in a "Rooms"
  item and each room with a ceiling in "Ceiling — ACT" / "Ceiling — GYP" /
  "Ceiling — open to structure" / "Ceiling — other", area-with-perimeter
  items the expander prices off area and perimeter. A ceiling item takes the
  matching starter assembly when the company has it.
- **Two starter assemblies for ceilings.** ACT2 (2x2 tile, main tee, 4' and
  2' cross tees, hanger wire, wall angle off the perimeter) and GYPC1 (⅝″
  board on hat and carrying channel). Quantities only; prices are the
  company's.

- **Studs on the item path.** A takeoff item now counts studs off its
  assembly's stud spacing the way a wall run does; a STUDS part on an item
  used to price nothing. Shipped behind a flag first; production impact
  checked 2026-10-22: 0 measured items linked to an assembly with a STUDS
  part, so no existing estimate changes, and the flag is gone.

The check: room finder on, starters added, find the walls and rooms on a
floor plan, give two rooms a ceiling type, save — the items rail shows
Rooms and one Ceiling item per family with their square feet; pick the ACT
item, its parts show tile, tees and wall angle with quantities; Send to
estimate; the estimate lists them. On the legend review, Add a type whose
legend prints a height: the row says "Height 10 ft (HIGH)" and the library
shows it.
