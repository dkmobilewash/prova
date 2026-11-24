### An apartment's unit type is not a wall tag (TAKEOFF_UNIT_LABEL_GUARD, off)

- With `TAKEOFF_UNIT_LABEL_GUARD=1`, a code printed as plain text is not read as a wall tag when an item starting "UNIT TYPE" sits within 5 of the code's own text heights (`unitLabels`, in both `wallTypeTags` and `bareTextTags`). Mid-City prints "UNIT TYPE / B1" in every apartment, and all 48 labels typed its NEW WALL as B1/C1 (1,627 ft wrong). Unset, nothing changes.
- The mid-span tie-break was looked at first and left alone. Turning it off cut that wrong footage only 44%, and Totem Lake and Sedgwick depend on it.

Measured by `zzLegendTextZT.eval.ts` (prereg-unit-label-guard.md), which now prints the guard's per-sheet count (`UNITLABEL`).
