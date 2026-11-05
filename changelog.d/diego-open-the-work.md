### The workspace opens on the floor plan of the work, and the queue's prices share one estimate tab (new-customer run v2, M2 and M5)

- **M2.** "Next: Run the takeoff ↗" opened the workspace on Baker's A100 OVERALL FLOOR PLAN, which repeats A101. Before the floor plans were scaled, it opened A111, the reflected ceiling plan.
  - Now it opens on the first sheet the whole-set run counts (`wallsPlan`, asked as if every sheet had its scale), so it lands on A101 before its scale is set too.
  - A sheet a person measured on still wins.
  - "Last measured" now means by a person (`MANUAL`), because the walls the takeoff posts by itself land on every counted sheet.
- **M5.** Each "Open the line ↗" in the review queue opened a new browser tab: nine prices, nine tabs. The link now targets one named tab per job, `estimate-<jobId>`, which moves to each line.
- `e2e/specs/open-the-work.spec.ts` covers both:
  - the workspace opens on A101, unscaled and then scaled, from the stepper's Next;
  - the second price moves the same estimate tab to its line, and no tab is added.
