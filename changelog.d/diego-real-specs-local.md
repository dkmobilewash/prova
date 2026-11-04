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

**And the three CI skips that did not need real drawings, dealt with the other
two ways.** `takeoff-one-sheet.spec.ts`'s two tests skipped on "sheet 1 has no
scale": the spec stitches committed fixtures into a three-sheet set and never set
a scale, so Find the walls was disabled on every CI run and neither test ever ran
there. Its first step now scales sheet 1 (S02, half the sheet is 48 ft) through
the app's own two-click flow, copied from `takeoff-workspace.spec.ts`, and both
tests ASSERT Find is enabled where they used to skip. `takeoff-workspace.spec.ts`
step 22 (answer-key mode) needs a server that allows labelling, which CI's refuses
by design (`answer-key-gate.spec.ts`), so it moved whole — byte-identical — into
`e2e/local/answer-key-mode.local.spec.ts` with its own S02 setup, collected by the
real config. The rest of the workspace spec stays in CI.

Running one-sheet for the first time found one more thing its skip had hidden:
its two later health checks omitted `signedIn: false` on `/takeoff/[id]`, a route
built with no top bar — the same omission its first test's comment records
fixing. Every leak assertion passed on that run; the test failed only on the
missing main navigation. Both calls now pass the exemption the rest of the suite
passes on that route, and all three tests pass locally.

With `main`'s three new workspace steps merged in, the CI config collects 164
(190 on `main` less the 26 that moved), and no test left in it can skip for want
of a drawing, a scale or a labelling server.
