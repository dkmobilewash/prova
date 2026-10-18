### #510's last experiment, as a button nobody has to press (Diego)
`diego/hydration-probe`

CLAUDE.md's #418 entry ends on a confound it names itself. A 96-load sweep
against `next dev` **on a laptop** produced ZERO mismatches, while production
mode in CI reports 3-9 pages per run — so two variables moved at once, BUILD
MODE and MACHINE, and the defect is a race. The entry's own prescription:
*"run the probe in CI with `E2E_DEV_SERVER=1`, on the same runner class that
reports 3-7 mismatched pages in production mode."*

Nobody could, because there was nothing to run. This adds it, and adds nothing
else.

## Why it is a separate config and a separate directory

The obvious implementation — a spec in `e2e/specs/` — would have joined the
suite that gates every PR, and that is the one thing it must not do. Three
reasons, each already written down somewhere in this repo:

- a dev build **never prints** `Minified React error #418`, so
  `lib/health.ts`'s classifier files every mismatch as a CRASH, failing the
  step it happened on rather than step 11;
- the one previous dev run in CI took **12.7 minutes** and produced its own
  timeouts and an `ERR_CONNECTION_RESET`;
- `playwright.config.ts` says in as many words not to read a pass/fail verdict
  off a dev run.

So the probe lives in `e2e/probes/`, which the `e2e` job's `testDir: "./specs"`
cannot see, under `playwright.probe.config.ts` — the same second-config pattern
`playwright.public.config.ts` already established. The workflow's whole trigger
list is `workflow_dispatch`.

**That isolation is measured, not asserted.** The gating suite collects
**94 tests in 29 files** with this branch applied — the same 94 CI reported on
#631 — and zero of them match "probe". The probe's own config collects exactly
1. Checked in both directions, because "it should not be picked up" is the kind
of claim this repo has been wrong about before.

## What the probe asserts, and what it only prints

Every assertion is about THE INSTRUMENT. The measurement is printed for a
person to read, per the config's standing instruction.

- **Each load is proved HYDRATED** (a `__reactFiber$` key on a real element).
  React cannot mismatch on a page it never hydrated, so an un-hydrated load is
  a silent zero that would read as a clean one.
- **A POSITIVE CONTROL runs last**: one injected `<div>` immediately inside
  `<body>` — inside React's own tree, since the App Router renders `body` —
  which is the ColorZilla mechanism from the #61 entry. The probe FAILS if it
  cannot catch a mismatch it caused itself. Three arms of the earlier
  investigation died exactly here, and *a control that does not fire is the
  instruction to fix the harness, never a result to read.*
- The control asserts the **error**, not the injected node's presence: React
  says the tree "will be regenerated on the client", and the regeneration
  deletes the node — so asserting presence reds a working control. That cost a
  wrong red the first time.
- It matches the dev build's hydration **sentence** rather than an error
  number, since the minified code and the prose are mutually exclusive.

Four routes and six loads each, with one worker, because `next dev` dies after
about ten compiled routes — and the two memory failures need different fixes:
`--max-old-space-size` cures "approaching the used memory threshold" and does
NOT cure `Zone Allocation failed`, whose next symptom is
`ERR_CONNECTION_REFUSED` and reads exactly like a broken app.

## Either answer is worth having

- **Zero, with the control firing** — the defect is the BUILD. Flight's
  3,200-byte deferral is the surviving mechanism and does not exist in a dev
  build, and the laptop result was not a laptop artefact.
- **Any mismatch** — it was the MACHINE, the laptop zero means nothing, and
  the log names the ELEMENT and its component stack. That is the one thing no
  production run can ever give, however green or however red.

## What this does NOT change

No product code. No schema, no migration. No existing workflow, config or spec
file is edited — four new files, three of them diagnostics and one a workflow
with no automatic trigger. `typecheck` 5/5, `lint` 5/5, 573 files / 8,924 unit
tests, and the gating E2E collection count unchanged at 94.

The probe has NOT been run yet. Its result belongs in CLAUDE.md's #510 entry
when somebody presses it, and that write-up is the point of the button.
