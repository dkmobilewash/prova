# Revision compare (2026-11-03)

A sheet uploaded again in a later plan file (same sheet number, by the sheet index or the typed label; `A-101` and `A101` are one sheet) gets **Compare with earlier version** on its toolbar. The server reads both sheets' line work, slides the new one over the old to where most ink agrees (translation only), and reports the pieces of line each has that the other has not: added in green, removed in red dashes, with the counts in words beside them. It lists the takeoff items measured on the earlier version that run within a foot of a change, and offers Find the walls and Find the rooms on the new version. Nothing is stored.

## What the training sets hold

No training set carries a same-layout revision of a sheet.

- **Eleven03 A2.20** is the only sheet number in two files (2025 permit set and 2026 approved set). It is a real revision but re-laid out: two parking levels added and every floor moved on the sheet, so 27% of its lines agree after alignment. The panel says it was probably re-drawn rather than drawing 140,000 pieces.
- **Murray Tower A001, AD106, AD107; Crosslines D101; Palomar A-1** appear twice in one file, but each pair has different titles and 9-21% agreement: two sheets sharing a misread number, not revisions.

## Measured on edited copies

Real line work, with everything in one patch deleted, a new two-line partition added, and the copy shifted 0.41% x 0.27% of the page as a re-plot would. "Visible" is a brute-force count of the edit lying farther than the slack from lines that stay; a change drawn on top of a line that stays cannot be seen by any line comparison.

| sheet | removed found / visible | added found / visible | reported outside the edit | shift error | time |
| --- | --- | --- | --- | --- | --- |
| Joplin A-101 | 0.278 / 0.281 pw | 0.080 / 0.079 | 0 | 0.0001 | 0.6 s |
| Baker A101 | 0.102 / 0.128 | 0.035 / 0.030 | 0 | 0.0001 | 0.2 s |
| Topeka | 0.234 / 0.241 | 0.080 / 0.080 | 0 | 0.0001 | 0.1 s |
| E Street A2.1 | 0.024 / 0.025 | 0.016 / 0.018 | 0 | 0.0001 | 0.6 s |

E Street's patch was mostly lines drawn twice, so little of the edit was visible at all. Scripts and outputs: `~/Claude Folder/takeoff/shots/revision-compare/`.

## Limits

- Translation only; a sheet re-plotted at another scale or re-laid out compares as mostly changed.
- Line work only; text that changed (a room renamed, a note edited) is not compared.
- The earlier version's measurements stay where they were drawn; nothing moves them to the new sheet.
