### A window drawn as two frame pieces is counted once (Diego)
`diego/window-false-hits`

Topeka's 46 false windows on training (the only training sheets the count covers that have
false hits) broke down as follows:
- **16 second counts** of a window already counted: some windows are drawn as two frame
  pieces either side of a mullion, and each piece was typed and counted;
- **22 one-window misses-plus-false**: the count sits 2–5 ft from the reviewer's mark,
  because a long ganged frame puts its one count at the frame's middle;
- **8 strays**.

Frame pieces on the same wall run, collinear, whose ends touch or overlap (within 0.25 ft)
are now joined into one frame before they are typed (`joinedFrames`). The joined window is
lit along its whole span in the review queue. Pieces with wall between them stay apart.
A 1 ft gap was tried first: false fell to 33, but found dropped by 8 because real
neighbouring windows joined. So the gap is "touching", not "close".

| ROUND 13b windows, counted sheets | found | missed | false | tag right |
| --- | --- | --- | --- | --- |
| training, before | 139 of 182 | 43 | 46 | 137/138 |
| training, after | **139 of 182** | 43 | **40** | 135/138 |
| held-out (Hutto), measured once, after | 82 of 92 | 10 | 17 | 82/82 (unchanged) |

The 22 offsets are the next class. A ganged frame holds several windows and is counted as
one, at its middle. Splitting frames by width was measured before and raised false hits, so
it needs the mullions read, not a width rule.
