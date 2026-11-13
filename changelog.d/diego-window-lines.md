### Confirmed windows count on the bid, behind the Doors and frames setting (Diego)
`diego/window-lines`

A window count confirmed in the review queue ("Windows — A") wrote no estimate line, so it changed no
bid, which is what doors did before #1153. The same setting now decides: by others writes nothing. When the
company installs frames, each confirmed window adds its frame set at a new production rate (window frames
per hour) and the crew rate, as an EA line with its source. For a framing trade it also adds the rough
opening from the partition's own parts: king and jack studs (4 a window), and header and sill track,
each sized by the window's own width read off its frame (width × 2 + 1 ft of bearing). Confirming,
undoing and changing the setting all re-sync the lines.

An opening's framing line (doors and windows alike) with no price book behind it takes the cost
already typed on the job for the same part (the walls' studs and track), so the queue does not ask for
the same stud again. Baker, no AI, the 19:57 walk's job re-synced: $30,752.68 by others → $34,170.00
with doors and frames (doors $2,808.00; windows $609.32 over 11 lines for 9 windows; no opening line unpriced).

Also fixed, in the doors code too: an EA labor line was costed from its rounded hours, so 7 doors at
1.5 an hour cost $56.71 each, not the rate's $56.67, and lost their "your production rate" source. It
is now the crew rate over the line's own rate. Tests: `lib/estimating/doorLines.dbtest.ts`,
`doorLines.test.ts`, `productionRates.test.ts`.
