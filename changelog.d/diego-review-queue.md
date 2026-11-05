### One review queue: the stepper's Review is everything left to decide, one item at a time

The guided flow's Phase 4. Built from rows that already exist; no model is asked anything and nothing new is stored.

- **The queue** (`lib/takeoff/reviewQueue.ts`, loaded by `reviewQueueQuery.ts`), in this order:
  1. walls the model held off the estimate, "to confirm";
  2. untyped wall groups: runs on "Walls — untyped", grouped by the detection group they came from;
  3. floor plans with no scale (the plan set's sort);
  4. estimate lines with neither a price nor a cost.
- **In the workspace**, the stepper's Review (`?open=review`) opens it as a bar above the plan: one item, "N left to review", **Next** (skips without deciding) and **Close**. A "To review · N" button reopens it.
  - A wall or a group goes to its sheet and zooms to the run (a group's longest), through the viewer's existing focus.
  - Each item is decided with the piece that already decides it: *It's a wall* / *Not a wall* (`reviewWall`), the legend's **Set type** codes (`setWallGroupType`), the plan set's *Confirm* / *Use the printed scale* (`confirmSheetScales`) or *Set it by two clicks* (arms Set scale), and *Open the line ↗*, which opens the estimate tab with that line open (`?line=<id>#line-<id>`). Coming back to the workspace tab reads the queue again.
- **The stepper**: Review is done when the queue is empty, and its Next says "Review N items". The facts are the queue's own, so the bar and the list cannot disagree.
  - A run kept with *It's a wall* goes onto "Walls — untyped", so it can come back as a group to type, and its footage as a line to price. That is the truth of what is left, not a second count.
- `e2e/specs/review-queue.spec.ts` walks one of each kind to an empty queue and a done Review. The takeoff rows are seeded, because CI cannot run detection on a stubbed upload.
