### Two tabs on one takeoff: checked in a browser, every run

A new e2e spec signs one person into two browser contexts on the same takeoff workspace:
- A scale or a measurement saved in one shows "changed in another tab" in the other when that one is returned to.
- A tab's own scale save does not trip its own banner. This is the case #1222 fixed, including the wall finder's rows landing afterwards.

Chrome had reported no warning. Its tab stayed focused, so the browser fired neither `focus` nor `visibilitychange`, and the check, which runs on coming back to a tab, never ran. The spec fires the window's `focus` event: a browser-made `visibilitychange` can't be produced under Playwright, which opens pages as windows and reports them visible. Removing the workspace's focus listener turns the spec red.
