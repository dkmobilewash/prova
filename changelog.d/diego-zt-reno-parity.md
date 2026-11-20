### The zero-touch eval holds what the renovation model holds (Diego)
`diego/zt-reno-parity`

Eval-only. Detection runs R (`TAKEOFF_WALL_RENO_MODEL`) on renovation sheets
paired with their demolition plan and holds every kept run it scores below
0.10; `zzZeroTouch.eval.ts` never called it, so the zero-touch restatement
counted those runs as posted junk. Measured on the 0700 snapshot before this:
about 697 ft (~$12.5k) of paired-renovation junk the product does not post.
The eval now calls `renoModelRemovals` with detection's own inputs, after the
run model's step, and prints `ZT RENOMODEL ON/OFF`. No product change: R-ALL
and R-UNPAIRED are not in this PR. Check: a census in `wallRunModel.test.ts`;
deleting the eval's R line turns it red.
