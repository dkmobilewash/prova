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

### Six things the Baker walkthrough showed an estimator, fixed (2026-10-22)

- A concrete or masonry legend type no longer gets metal studs: the sight
  read's material reaches the library action, and such a type is written
  with board and insulation only.
- "Add these" never writes loose measurements by itself. A group nothing
  prices asks what it is — a type first (the sheet's note, then the
  verdict's candidates, then every type with parts), a new type from the
  group with its thickness filled in, or plain measurements, last.
- The picker says what tells two types apart: board one side or both,
  layers, rating, insulation — so S6B and S6C are not two identical rows.
- Each legend type shows its height and confidence on the review row
  before Add, the same reading the library keeps.
- "Not enclosed" no longer lists title-block labels or note sentences; and
  "Rooms" is reported as square feet of floor, a check figure, instead of
  as an item not priced.
- Find the walls is disabled, and says so, until the sheet has rendered.
- The wall-type form gained a thickness field; a hand-made type with none
  could never be offered for a drawn group.
