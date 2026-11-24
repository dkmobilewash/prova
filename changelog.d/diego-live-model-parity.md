### The live "Run takeoff" list holds back exactly the runs detection holds (behind TAKEOFF_LIVE_MODEL_PARITY, off) (Diego)
`diego/live-model-parity`

Found by the second session. The customer's live list, built in the browser, applied neither the learned run model
nor R. Both lived only in server detection, so the list a contractor watched was less filtered than what posting,
auto-post and the evals used. It also dropped pairwise-doubted runs at the configured cut while the server holds at
0.55.

- **One function.** Detection's held block (the pairwise 0.55 hold, the run model, R) is lifted unchanged into pure
  `heldOnSheet` (`lib/takeoff/heldOnSheet.ts`). The run model's decisions are split from its file loaders
  (`wallRunVerdicts.ts`, re-exported, so no caller changed).
- **Both sides call it.** Detection, and with the flag on the viewer, which receives the same models as data from the
  same loader (`serverHeldModels`). `liveParityCensus.test.ts` fails if either stops, or if anything else starts
  deciding holds itself.
- **No schema change.**

**Measured, pre-registered** (coordination `prereg-live-list-parity.md`, two amendments, each before its numbers):
server detection itself vs the real app in Chromium, on every keyed sheet of snapshot 0545.
- **Held-set parity:** on all 114 sheets where both sides offered the same runs, the held runs are identical (3,508
  runs).
- **The strict 0-difference bar is missed on 3 of 117,** none of them in the held set:
  - Broadway A1.0, where server detection runs out of its time budget;
  - two pages the test browser never renders.
- **Flag off equals today** by construction and on a fixed 20-sheet walk. Its two differences are detection's
  run-to-run variation and walk order, both measured.
- **On the ten fresh wave-2 sheets** the live list's junk drops 3,814 → 2,650 ft, while key-covered footage moves
  1,069 → 1,062 ft. This is information, not the gate.

**The first comparison was void.** `e2e/run.mjs` silently replaced the real wall model with its invented stump, so
the browser and the server check ran different models. `E2E_WALL_MODEL` now names the real one for a walk; unset, the
stump as before.
