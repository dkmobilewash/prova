### The paired-only R model ships, after passing its one pre-registered held-out shot

Release Exam 3, verdict 2 (2026-11-25): the second's attempt-1 R candidate (a
paired-only split of the failed wave-2 bundle, Diego's ruling: one held-out shot, ships
only on PASS) passed on its card's own bars with ZERO sets worse — pooled junk+missed
18,437 -> 18,121 ft (junk -311, missed -5), every per-set mover an improvement,
held-out board-over $ down $10,989 as supplementary.

This PR is the ship: `apps/web/models/wall-reno-model.json` is replaced by the
candidate (sha256 d84461f5…, verified at measurement, at pin, and at ship) TOGETHER
WITH its parity control `wall-reno-model.control.json` (sha256 660f5ce6…, the card's
third hash) — the wallRunFeatures parity test rightly refused the model without its
control, which is that census doing its job. A v2-feature/50-column drop-in — no code
change, no flag change. The card
(eval-out-second/rj2-R-ARTIFACT.md) and the shot outputs (eval-out-second/rj2-shot/)
are the record. Since #1250 the model files load in production, so this goes live on
deploy. Exam-4 what-changed material; Exam 3 was locked before this merge.
