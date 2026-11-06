### chrome-retest step 1: click the run where the sheet is, once it has settled

**What happened:** on main's CI at 68b531be, step 1's click after Esc picked nothing.
- Opening and closing the bottom strip resizes the frame, and at Fit the sheet re-fits with a render that finishes later.
- The step reused a point taken before the first click, so the second click could land off the run while the sheet was still moving.

**Fix:** the step now waits for the sheet's box to hold still, then works out the point again. The assertions are unchanged.
