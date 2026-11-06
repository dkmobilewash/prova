### The plan-reading opt-in, proved in a browser from Settings to the plan set (Diego)
`diego/ai-optin-persists`

Reported on :3010 (2026-11-06): ticking "Wall types from the drawings" in Settings →
Assistant and pressing Save said "Saved", while `optedInFeatures` read back empty. So
no legend read ran, and no wall type or height came off the drawings.

`ai-switch.spec.ts` step 6 now drives the real round trip in Chromium:
- before: opening the plan set says plan reading is off and queues nothing;
- tick and save the opt-in in Settings;
- the database row holds `PLAN_TEXT_READ`, and the box reads it back on reload;
- opening the plan set again queues its legend read (`queueLegendRead`: one
  WALL_LEGEND run, one task per sheet), checked in the database.

The opt-in is the one feature that reads the other way (off until ticked), and the
spec's first five steps never touched it.

What was checked before writing it:
- the save action stores the opt-in when the form posts it (against a real Postgres);
- the form posts `feature:PLAN_TEXT_READ` (in happy-dom);
- :3010 was started on `prova_dev`, the database the report read;
- the Takeoff features toggle the report could not find renders only on Settings →
  Estimating, by design.
