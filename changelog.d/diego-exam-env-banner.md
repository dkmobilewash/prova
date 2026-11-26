### The eval says what RAN: the ZTENV banner, the junk dump committed, and exam scripts as files

Diego's env-audit order 2026-11-26, after Exam 3 and its re-score were found to have
run NOT-DRAWING OFF: a script exported the bare `TAKEOFF_NOT_DRAWING`, the code reads
only `NEXT_PUBLIC_TAKEOFF_NOT_DRAWING` (offeredCandidates.ts), and nothing in any log
could show the difference. The R one-shot was voided the same hour for the mirror
error (its lone arm took its env from the plan, not from the baseline run).

Three fixes, none optional again:
- zzZeroTouch prints a ZTENV banner before anything runs: the EFFECTIVE NOT_DRAWING
  (the product's own read, with the bare name shown beside it as "READ BY NOTHING"),
  RENO_UNPAIRED, every model path WITH ITS SHA, the heights key path+sha, legend
  cache, zone keys, ZT_HELD, presses. The log now records what ran, not what the
  command meant.
- The third's ZT_JUNKDUMP block (posted junk runs with nearby text, for family
  analysis) is adopted as committed code — env-gated, no scored path touched.
- `scripts/exam-runs/exam3-true-env.sh` and `exam3-r-ab.sh` are committed files, per
  the order: every exam/verdict command is a file, never inline. The A/B script runs
  BOTH arms in one process environment with only TAKEOFF_WALL_RENO_MODEL differing,
  and judges the card's bars itself.
