### The locator workflow could only ever fail (Diego)
`diego/locator-build`

#699 shipped the #510 mismatch locator with a workflow that **never ran the
probe**. The dispatched run died in `webServer` startup:

```
Could not find a production build in the '.next' directory.
Try building your app with 'next build' before starting the production server.
```

#### The mistake, plainly

I built the workflow by copying `hydration-probe.yml` and removing
`E2E_DEV_SERVER`. That flag is the only thing that made the copy work: `next
dev` compiles on demand, so the dev probe needs no build step and gets away
without one. `next start` — which the same config runs once the flag is absent —
does not.

**I took the flag out without adding the build the production path needs.** The
workflow was structurally valid, passed every check I wrote for it, and could
not have succeeded on any commit.

What the checks missed is worth naming: they verified the trigger list, the
absence of the dev flag, the live-key refusal and the YAML shape — every
property I thought to assert — and none of them asked whether the steps could
actually run in order. A workflow is not a file, it is a sequence, and nothing
short of dispatching it tests the sequence.

#### The fix

The probe step now runs through `pnpm test:e2e`, which builds first — the same
route `ci.yml`'s own `e2e` job takes, and the same command that ran this probe
successfully on a laptop. `run.mjs` also respects `E2E_DATABASE_URL`, which the
job already sets, so it uses the postgres service rather than booting a second
one beside it.

#### Checks

- The workflow is checked for the shape that caused this: it must call
  `pnpm test:e2e` and must not call `playwright test` directly.
- Dispatching it is the only real test, and that is the next step rather than a
  claim made here.

#### And the probe was looking in the wrong place

With the workflow fixed, the first real run came back **24/24 loads hydrated, 0
mismatches, control 3/3** — a readable zero, on a runner, in production mode,
while the gating suite was still finding #510 on the same branch.

Two reasons, and the second is the one that matters:

- **"one load in three" is stale.** CLAUDE.md measured 12 mismatches in 40
  reloads over those exact pages — `/safety` 5 of 10, `/settings` 5 of 10 — and
  that **predates the two fixes that have since shipped.** Step 11 went from
  14-19 pages to 6 to 1 after them. Sizing a probe from the old rate sizes it
  for a defect that was partly fixed.
- **the journey walks about thirty destinations, not four.** It opens every nav
  group, reads every `a[href^="/"]` and `goto`s each. Five recorded page lists
  are nearly disjoint with only `/dashboard` recurring, which is what a low-rate
  race over a wide route set looks like — and is exactly what four pages cannot
  sample.

So the probe now enumerates the nav the same way `journey.spec.ts` does, two
passes over every destination, with the same ≥20 floor the journey asserts. It
cannot drift from the product either: a page added to the sidebar is probed
without editing the file.
