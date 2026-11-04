### The specs that need real drawings left CI, so the e2e job can stop failing on skips (Diego)
`diego/real-specs-local`

Nine Playwright specs walk the takeoff on real client drawings, which never
enter the repository. In CI they could only skip — 25 tests, every run — and
`e2e/verdicts.mjs` counts a skip as a failure on purpose, so the signed-in `e2e`
job's verdict step was red for a reason that was never a defect.

They moved whole, with `git mv`, from `e2e/specs/` to `e2e/local/` as
`*.local.spec.ts` — the same place the billing and takeoff click lists live,
which the main config's `testDir: "./specs"` never reaches. Six are byte-identical
renames; three changed one comment line each (a file name or a `--config` path).
No assertion moved, changed or went away. They run on a laptop with the drawings
through `pnpm test:e2e -- --real-plans [name]`, which picks
`e2e/playwright.real.config.ts` (the main config, pointed at `local/`, with the two
click lists excluded).

The check: `playwright test --config e2e/playwright.config.ts --list` collects
162 tests where it collected 187, and the 25 missing are exactly the 25 that
moved; the real config lists those 25 in 9 files; the billing and takeoff click
configs still list 42 and 71. CI's `E2E_COLLECTED` is derived by `collected.mjs`
from that listing, so it follows on its own.

**Not fixed here, and still skipping in CI: three tests that do not need real
drawings.** `takeoff-one-sheet.spec.ts`'s two skip because sheet 1 of its
committed, stitched fixture has no scale, so Find the walls is disabled.
`takeoff-workspace.spec.ts` step 22 skips because answer-key mode is refused on a
customer-shaped server by design (`answer-key-gate.spec.ts`), and is covered by
`e2e/smoke-labeling.mjs`. Until those are dealt with, the verdict step still sees
three skips.
