### A re-find keeps only what a person decided, and a sheet the set does not count says so

Chrome round 6. Baker A101 showed 0 runs to confirm through every Find and every
whole-set re-run. Two things held it there. Round 5's refresh put every surviving run
back on the label it had, so the untyped labels an older refresh wrote were kept for
good. And a whole-set re-run skipped any sheet that already had walls, so nothing ever
read those labels again. A refresh now restores only the labels a person writes ("wall,
kept", which both keep actions now write, and "wall, dropped"), and every other label is
read from the wall model again. A re-run now finds every counted floor plan again,
leaving alone any sheet whose walls were already sent to the estimate.

The planner marked Baker A100 "already found" rather than "same level as A101", because
saving its scale had stored walls on it. Round 5's "found N ft, not counted" line therefore
never showed on a real job: its test used sheets with no walls. A sheet with walls is now
grouped by level like any other. The viewer gets each sheet's counting sheet from the
loader. On A100, "It is a wall" and a review keep now say "This sheet isn't counted: A101
shows the same level" instead of doing nothing visible.

Keeps made before this change wrote "wall, untyped", which is indistinguishable from the
model's own label, so a re-find may hold them again. A run moved to another item by hand
is not restored either.
