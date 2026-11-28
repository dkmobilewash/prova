### A wall type's height, answered once

**W2 item 4 of the Walls v1.0 Finish Plan** (coordination/type-height-once.md, REVIEWED by the original, with Amendments
1-2). A type split over level items ("W1 walls · levels 2–4", "· levels 5–9") asked for its height once per item.

**What changes:**
- **H1:** answering one item's height, through the queue's height question or a group's Enter, also sets it on the
  type's other items on the job that have NO height.
  - It never overwrites a height already there: a person's, or the schedule's default copied at creation. Nothing
    records a person's answer per item, so a non-null height is taken to mean something.
- **H2:** never for a type whose walls run to the structure. Its height is each level's floor-to-floor.
- **H3:** a level item created later starts from the type's answer, when the schedule gives no default and the job's
  items of that type agree.
- **H4:** the queue's Undo puts back the answered item AND every item the answer filled.
- **T4:** the queue says it: "9 ft also set on 2 other level items of this type that had no height."
- No migration.

**How it is judged (Diego's chat yes, 2026-11-28):** height answers needed per JOB, TRAINING, ON vs OFF, in one script
(`scripts/exam-runs/w2-heights-ab.sh`). Per-sheet actions-to-exact cannot see a saving across levels, so it is not used.
- **The counter** is `heightAnswersPerJob` in `actionsToExact.ts`. It uses the product's own level split (`runLevels`
  over `sheetViews` captions), and merges only types positively known to be schedule-free from the product's cached
  legend read. The to-structure test is the product's own `runsToStructure`.
- **One run was proposed and withdrawn:** a census found the eval's import graph reaches `wallItems.ts` at runtime
  (via `pairDemoPlans.ts`). So it runs two arms, with the 2MIN headline required to be byte-identical across them.

**Checks:**
- Tests first, red on main where behaviour is new: dbtest 8, unit 24.
- Mutations: 9, all red.
  - "Fill overwrites set heights" first survived, because the update keeps its own NULL guard.
  - It is now mutated with both guards removed, and is red.
- T1's to-the-cent estimate check moved to the production proof (a bare type writes no lines; Amendment 1).
