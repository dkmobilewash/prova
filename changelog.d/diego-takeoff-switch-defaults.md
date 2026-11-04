### New companies start with whole-set walls, rooms, and doors and windows on

- Diego's decision, 2026-11-04: `Company.wholeSetTakeoffOn`, `roomFinderOn` and `doorsWindowsOn` default to true. `scannedPlansOn` stays false. The migration changes only the column defaults and updates no row, so an existing company keeps the values it has. Prisma also writes static defaults into its own INSERT, so a stale generated client keeps creating companies with them off; regenerate after pulling.
- With rooms on, the workspace chrome measured 192px against its 170px budget at 1280 with the items rail open. "Find the rooms" pushed the scale status onto a row of its own. The status now stays on the button row and is cut short there, with the full text in its tooltip.
- The dbtests that rely on a switch being off now create their company with it off. The rooms e2e turns the switch off itself, and on its first attempt asserts that a new company starts with it on.

Check: `pnpm test:e2e -- specs/takeoff-workspace.spec.ts specs/takeoff-rooms.spec.ts`.
