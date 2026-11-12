### Demolition plans the pairer missed are offered; the bid check stops asking to pair a sheet that has none (Diego)
`diego/demo-pair-totem`

**Totem Lake Dental has no separate demolition plan.** Its A2.1 is titled "DEMOLITION FLOOR PLAN &
FLOOR PLAN": one drawing, the demolition and the new work on the same floor plan. Its wall legend
says shaded walls are new, dashed walls are removed, and outlined walls are existing to remain. No
other sheet in the set draws a demolition plan, so plan comparison had nothing to pair, and the
pairer was right. The bid check still said "none compared with a demolition plan", with the fix
"Pair A2.1 with its demolition plan", which cannot be done.

- The bid check now says it: "A2.1: shows existing work on the plan itself (the set has no separate
  demolition plan for it), 66 walls taken off, none set aside as existing". The fix opens the
  sheet, where the review queue's "Set aside all walls drawn like this one" takes them (#1135).
- A sheet whose existing walls a person set aside (a work area, or walls drawn like one they
  picked) no longer counts as uncompared.

**Checking every renovation set turned up two real misses, now fixed** (`pairDemoPlans.ts`):

- **Bluetooth:** AI101 (CONSTRUCTION PLAN) was never paired with AD101 (DEMOLITION PLAN). An AI or
  AF series is architectural, like AD. When the number twin (AD101 → A101) is missing, the same
  number in the demolition plan's series is taken (AD101 → AI101). AD102 (CEILING DEMOLITION PLAN)
  now pairs with the reflected ceiling plan AI131 by title.
- **Falafel Fresh:** ED2.20 "EXISTING / DEMO PLANS" was read as electrical. In a set with no E
  sheets, and under a title that names no trade, the E is "existing", so it pairs with A2.20. An
  electrical demolition plan in a set with E sheets stays electrical (Wendell's ED101).

Every set with renovation sheets in prova_dev, before → after: **3 new pairings** (Bluetooth AI101 →
AD101, AI131 → AD102; Falafel A2.20 → ED2.20), **none lost**, Totem unchanged.

Checked by `pairDemoPlans.test.ts` (Bluetooth and Falafel fail on the old pairer; the electrical
case holds), `bidCheck.test.ts` and `bidCheckExisting.dbtest.ts` (mutations: without the
no-demolition-plan branch, and without the set-aside filter, each fail).
