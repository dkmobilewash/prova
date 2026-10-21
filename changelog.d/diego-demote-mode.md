### Takeoff: "demote, don't hide" for the wall check — behind a per-company switch, OFF

"Check these are walls" used to drop a run it called casework or reference
from the sheet entirely, with "Press Find the walls again to start over" as
the only way back. With the new switch on (Settings → Estimating, owner
only), such a run stays drawn in grey, dashed, with the model's own reason
beside it ("probably not a wall — casework: a counter"), is left out of the
found-walls total, and has one button, "It is a wall", that puts it back in
the list and the total. Never in `?key=1` labelling mode.

The check: turn the switch on, find the walls on a sheet, press Check these
are walls. Demoted runs are grey on the drawing and listed under the panel
with the total above them unchanged by their footage; pressing "It is a
wall" on one raises the Found count by one and removes its grey line. With
the switch off the panel reads exactly as before.

`Company.demotedWallsOn`, migration `20261023000000_demoted_walls`
(additive, one boolean). `lib/takeoff/demotedRuns.ts` holds the rule;
`e2e/specs/takeoff-demoted.spec.ts` drives it in a real browser by replaying
the check's own response with a canned verdict, because the e2e runner
strips the model key on purpose.
