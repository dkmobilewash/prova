### Takeoff: "demote, don't hide" for the wall check — behind a per-company switch, OFF

Two sources demote a run, and both used to hide it. With the new switch on
(Settings → Estimating, owner only), a demoted run stays drawn in grey,
dashed, with the reason beside it, is left out of the found-walls total, and
has one button, "It is a wall", that puts it back in the list and the total.
Never in `?key=1` labelling mode.

- **The trained wall classifier, at Find time, no model call.** The file
  `TAKEOFF_WALL_MODEL` names (the trainer's `wall-model.json`) scores every
  paired run; one scoring below the cut — the file's own `cut`, else
  `TAKEOFF_WALL_MODEL_CUT`, else 0.3, the LOBO-chosen value — reads "probably
  not a wall — the wall model doubts this one (score 0.21)". These are the
  runs the finder's veto would have dropped. A retrain is a new file and, if
  the sweep moved, a new number. A model whose columns are not this build's
  is refused and logged, as `deciderFor` refuses it everywhere. No file
  configured: nothing is demoted by it.
- **"Check these are walls", the manual second opinion.** It used to drop a
  run it called casework or reference with "Press Find the walls again to
  start over" as the only way back. Its verdict now overwrites the model's
  for every run in view — an AI "WALL" puts a model-demoted run back — and
  reads "probably not a wall — casework: a counter".

The check: turn the switch on, with `TAKEOFF_WALL_MODEL` set, find the
walls on a sheet. Some runs are grey on the drawing at once and listed with
a model score, the Found count below them excluding their footage. Press
Check these are walls: its verdicts join or replace the model's. Pressing
"It is a wall" on a row raises the Found count by one and removes its grey
line. With the switch off, or no model file, the panel reads exactly as
before.

`Company.demotedWallsOn`, migration `20261023000000_demoted_walls`
(additive, one boolean). `lib/takeoff/demotedRuns.ts` holds the rule and the model scoring,
`lib/takeoff/wallModelFile.ts` reads the file;
`e2e/specs/takeoff-demoted.spec.ts` drives it in a real browser by replaying
the check's own response with a canned verdict, because the e2e runner
strips the model key on purpose.
