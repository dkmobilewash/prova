### A room leak is a wall inside the merged room, not a wall across the line between two tags

`zzRoomDetect` called a merge a LEAK when the straight line from a tag to its nearest merged
partner crossed a key wall. In the Tallinn flats every hall opens into its living room with no
wall between, and that line clipped a 1.5 ft stub, so 65 open-plan pairs were reported as
leaks. A merge is now a leak only when the merged REGION itself holds key wall (3 ft or more
with its middle inside the polygon), a wall the detector should have closed against.

BIM keys re-reported: leaks **103 → 4** (smiley-west KG 1D31/1D33, clinic 1F 2A12/2A12-A),
virtual splits 124 → 223. The split is bimodal (223 regions hold 0 ft of key wall, 4 hold
3–10 ft), so the 3 ft line decides nothing. Measured and within-5% counts do not move.

What the corrected number says: with perfect walls the room step has 4 real leaks in 640 rooms.
The remaining 223 are rooms the models split with a line nobody drew, which no wall-based
detector can separate.
