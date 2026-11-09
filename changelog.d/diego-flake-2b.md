### Workspace step 2b: its test limit covers its own 60 s wait

Step 2b waits up to 60 s for the new tab to draw the sheet, inside the default 30 s test
limit, so a slow first render failed it with "Test timeout of 30000ms exceeded". That cost four
gates on 2026-11-08 and 2026-11-09, with every other step green. The step now sets 120 s.
