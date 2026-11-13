### The wall run model at Run takeoff, behind `TAKEOFF_WALL_RUN_MODEL`: remove-only plus high-confidence auto-post, measured as the product runs it (Diego)
`diego/wall-model-wire`

#1176's run model passed its held-out final exam (9,578 ft wrong vs the hand rules' 10,859), so
it is now wired into Run takeoff, behind an environment variable. With `TAKEOFF_WALL_RUN_MODEL`
unset, which is the default, nothing changes.

- **Remove-only.** Detection scores every run on offer (`wallRunModel.ts`). A run the hand chain
  would post (kept by the demolition compare, not held by the pairwise model) that scores below
  0.10 joins the existing "to confirm" hold. It stays on the sheet, off the estimate, and one
  click brings it back.
- **High-confidence auto-post.** Each run's score is stored (`runScore`). For a company with
  "Auto-post proven items" on, a run at or above 0.9621 posts as "Walls (auto, high
  confidence)". `MODEL_EVIDENCE.walls` holds the numbers: LOSO 97.02% (1,578 ft right / 48 ft
  false), held-out 100% (417 / 0). Before this change, posting read the pairwise score, a model
  nobody had measured at that line.
- **Undo per sheet.** The queue's "posted automatically" header and its Undo list now count
  these walls. Before, a sheet whose only auto-posts were high-confidence walls had no Undo row.

`TAKEOFF_WALL_MODEL` is a different variable. It names the PAIRWISE model the grey-out already
reads, and the run model needs it as an input. Reusing that name would have switched the run
model on everywhere at once.

New companies are created with `autoPostOn` on (since #1099, for doors). So once the variable
is set, new companies auto-post walls too. Setting it is Diego's call.

The check: the exam's feature table now builds its columns with the product's own call
(`runModelRows`). `zzRunModelGate.eval.ts` sends every keyed sheet through the product's path
and compares, run for run, against the exam's table. Parity: 47 of 48 training sheets give
identical scores. The 48th is Macon-Bibb A1-1, which #1177 began pairing after the table was
built. Wall error, gate off → on:
- training (each set on its own LOSO fold, `scripts/wall-model/folds.py`): 16,919 → 15,092 ft;
- held-out: 10,859 → 9,578 ft, exactly the exam's figures.

In both, no set got worse by more than 2 points and 50 ft. Auto-post came out at 97.02%
(training) and 100% (held-out), matching the evidence row.
