### Before a sheet has a scale, the work-area prompt says so instead of offering buttons that do nothing

**Found by #1263's production check (2026-11-26, dpl_H6dsLcJ2).** On a renovation sheet with no scale yet, the work-area
prompt (#1261) showed and both "Draw work area" and "Whole sheet is new work" did nothing: no busy state, no error, nothing
saved. The viewer has no sheet row to hold a work area until a scale is saved, and the handler returned quietly.

**What changes.** Until the sheet has a scale, the prompt keeps its words, adds "Set this sheet's scale first.", and shows both
buttons disabled. They enable in the same render the scale lands, with no reload.

**Checks.** Two tests red on main fefbed38 (the no-scale state, and enabling as the scale lands); five mutations, each red.
