### Answer-key mode draws what a contractor sees (Diego)
`diego/key-mode-customer-list`

A key-mode find now draws the CUSTOMER offer on the sheet — the same list
`offeredCandidates` gives every customer path — instead of the finder's raw
runs. Diego's key screens were filling with title-block, notes and legend
runs no contractor is ever offered (Old Town Hall A105, Jane Hahan A2.1);
reviewing those grades the app's junk, not the drawing. The raw list is one
click away: "Show the set-aside lines" in the key panel (beside the hatch
toggle), applied at the next find on that sheet. Grading is unchanged by
construction: the rail's candidates (`candidatesFromLastDetect`) and the
saved labels read the RAW detection cache, never the drawn list — asserted
in `keyModeList.test.ts`, which also pins the seam and the plumbing; the
old raw-default mutation turns it red.
