### R, the paired-renovation wall model, at Run takeoff behind `TAKEOFF_WALL_RENO_MODEL`: remove-only, beside the run model (training error 15,231 → 15,015 ft with the run model on in both arms) (Diego)
`diego/reno-wire`

R (#1186) passed its held-out final: 2,324 ft wrong against the hand rules' 2,896, no set worse.
It is now wired the way the run model was (#1179). Unset, Run takeoff is unchanged.

**The rule, exactly reno.py's.** On a renovation sheet paired with its demolition plan (an aligned
prior), a run the hand chain posts (kept by the compare, not held by the pairwise model) that R
scores below 0.10 joins the "to confirm" hold (`renoModelRemovals`).

**With the run model on** (production sets both):
- The two decide independently, and a run either one removes is held. Both only ever remove, so
  together they can never post anything either alone would hold.
- Only the run model's score rides on the run (`runScore`, what auto-post reads). R's score is
  used and dropped, so auto-post is unchanged.

Measured through the product path on training (`zzRunModelGate.eval.ts`, labels-snap-20261114T0204),
with `TAKEOFF_WALL_RUN_MODEL` set in BOTH arms:
- total error 15,231 → 15,015 ft;
- R held back 394 ft of junk and 179 ft of real wall;
- no set worse by > 2 pts and > 50 ft (worst: Clerk +2.8 pts, +23 ft);
- auto-post 1,578 ok / 49 false in both arms.

R scored each of its 10 training sets with its own LOSO fold (`folds.py --reno`). Refitting R on
its table reproduces the committed trees exactly. Every other set got the committed R, which never
trained on it.

The check: `wallRunModel.test.ts`. R loads only from its own variable. It removes only on a paired
renovation sheet, below 0.10. Detection holds what either model removes, and only the run model's
score is stored. Each was red when broken. The committed control rows are asserted in
`wallRunFeatures.test.ts`.
