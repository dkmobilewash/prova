### An untagged group's picker: the legend's types ordered by thickness, with each one's picture

69 of the 72 queue actions on a three-floor set (Topeka, Hutto) are groups no tag names.
For those, the queue now lists the legend's types closest drawn thickness first, numbered
1–9. Beside each type sit its thickness (the library's, else the legend's stud and boards)
and its legend picture, cut from the plan's PDF. **Nothing is preselected**: the person
presses a number, then Enter.

**Measured on the 9 training sheets** (2026-11-10, one scorer's pairing,
labels-snap-20261109T0015, cached legend reads). There are 33 keyed untagged groups, on 6
of the 9 sheets. The closest type is the key's type for **24.2%** (23.0% of feet), and in
the top 3 for **63.6%** (71.5% of feet).
- 21 of the 25 misses are walls drawn closer to another type's thickness, by inches (Baker
  draws a 9-1/4" type at 3"). 4 are ties.
- Learning from earlier confirms reaches 27.3%; a prior from printed tags is worse.
- A preselection wrong three times in four invites a blind-Enter misprice, so Diego chose
  ordering without one.
- An untagged group that already had the "only type that thick" guess keeps it as before,
  now with its list ordered too.

**Topeka** has 22 legend types at only two thicknesses (4-3/4", 6-3/4"), so the order
there is two blocks of ties.
- **Keystrokes:** still 2 per untagged group (a number, then Enter), 69 groups, unchanged.
- **What changes:** where to look. The right type is in the first three about two times in three.
- **Seconds per group:** not measured. That needs a timed walk; it is not claimed here.

`components/LegendCrop.tsx` now holds the legend review's crop (`openPage`, `renderRect`,
`LegendCrop`), with a page cache and a 72 px `LegendThumb` for the queue.

**Tests.**
- `lib/takeoff/untaggedPicker.test.ts` tests the ordering.
- `e2e/specs/untagged-picker.spec.ts` covers one untagged group at 6.6": the queue lists
  ZQ7 · ZQ8 · ZQ4 with ZQ7's 7-1/4", Enter alone asks for a type, and 1 then Enter types it ZQ7.
