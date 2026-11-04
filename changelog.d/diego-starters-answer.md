### The starter assemblies say what they added, and the two browser steps waiting for it pass

- "Start from the common trade assemblies" kept its answer ("Added W1, W2, …; they arrive unpriced on purpose") in its own state, inside /wall-types' empty state. The add revalidates the page, the library stops being empty, and the empty state and the answer went together. `StarterWallTypesButton` now sits outside the empty-state/list switch and takes `offer` for whether the button shows.
- `takeoff-estimate-chain.spec.ts` waited for that answer and failed on main every time, including alone on one worker. It was not two specs colliding on a shared persona, as first guessed. `estimating-spine.spec.ts` step 3 still clicked "Start from two common wall types" and waited for "Added W1 and W2.", and both changed in #809. Its #707 note blamed a cold compile.

Check: `pnpm test:e2e -- specs/takeoff-estimate-chain.spec.ts specs/estimating-spine.spec.ts`.
