### Run takeoff in the workspace waits for the sheet's walls instead of posting nothing

The STUCK every new-customer walk since v2 has written down: the workspace's Run takeoff "adds nothing to the job". It does post, from the walls the finder stored when the sheet's scale was saved, but that finder runs after the response. On Baker's A101 in walk v6 the scale was saved at 15:25:06 and the walls stored at 15:25:48. A press in between found nothing stored, posted nothing and said nothing, so the walk went to the whole-set button on the Takeoff tab.

`postSheetWalls` now answers `waiting` while the sheet's newest scale is under three minutes old and nothing is stored under it. The viewer says "Putting the walls on the job as soon as this sheet's walls are stored…" and asks again every 3 s until they are posted. An old scale with nothing stored still reads as nothing found.

The check: `wholeSetTakeoff.dbtest.ts` (waiting on a fresh scale, then posted once the walls are stored; an old scale is not waiting) went red under mutation (wait set to 0). `run-takeoff-posts.spec.ts` now presses Run takeoff BEFORE the walls are seeded and sees the waiting line turn into "Put on the job…".
