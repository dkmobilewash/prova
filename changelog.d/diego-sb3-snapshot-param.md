### The v3 baseline script runs on a named, hash-checked snapshot (truth-audit restatement)

`sb3-baseline.sh` takes `SB3_SNAP` and `SB3_HASH`, so the held-out keys corrected by
the blind truth audit (v4, 2026-11-28) are scored from a committed script on their own
snapshot. It still refuses to run on a hash it was not told. `SB3_HELD_ONLY=1` stops after
the held-out half, for a correction that leaves every training input unchanged. With no
variables set, the script behaves exactly as before.
