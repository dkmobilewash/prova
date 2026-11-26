### "Whole sheet is new work" says it is working, and a second press does nothing

**Found in #1261's production proof (2026-11-25, dpl_654pQyLx).** After the press the screen did not change for 5-20 s:
the save and the re-find run before the prompt can go, and the button showed no busy state, so a person could press it
again and store a second whole-sheet work area (harmless to the walls, untidy, two Undos).

**What changes.** The button on the sheet's prompt, on the review queue's renovation step and on each whole-set row disables
at once and reads "Saving…" beside the app's Spinner until its save returns. The disabled attribute is what refuses the second
press. A state check inside the handler was written first and removed: it reads the value from the render the click came
from, so it guarded nothing, and the mutation that dropped it stayed green.

**Checks.** Three tests, one per button, red on main 6ef4b7af; six mutations (each button's label, the two disabled flags,
the viewer's flag never set) each red, 16 tests per run.
