# Holdout — run once, reported separately

20 seeded random plans (seeds in `holdout.ts`) built from the same partition types, junctions and export quirks. **A fix may be tuned on the main set; it must be validated here.**

| Case | Variant | Scale | Found/partial/missed of counted | LF found / key CL | Error | Phantom ft | Biggest loss |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H-1009__shx | shx | 🟡 declined, wrong reason | 28/2/1 of 31 | 1471 / 1618 | -9.0% | 62 | 77 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-8928__autocad | autocad | ✅ 1/8" = 1'-0" (title block) | 0/0/40 of 40 | 0 / 2068 | -100.0% | 2938 | 2080 ft: the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes |
| H-16847__autocad | autocad | ✅ 1/8" = 1'-0" (title block) | 0/0/26 of 26 | 0 / 1387 | -100.0% | 2053 | 1415 ft: the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes |
| H-24766__plot-black | plot-black | ✅ 1/8" = 1'-0" | 31/1/0 of 32 | 1805 / 1919 | -5.9% | 61 | 62 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-32685__revit | revit | ✅ 1/8" = 1'-0" | 25/4/5 of 34 | 1244 / 1560 | -20.2% | 45 | 89 ft: wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing |
| H-40604__shx | shx | 🟡 declined, wrong reason | 31/2/4 of 37 | 1308 / 1723 | -24.1% | 42 | 209 ft: wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing |
| H-48523__clip | clip | ✅ 1/8" = 1'-0" | 24/3/2 of 29 | 1270 / 1426 | -10.9% | 44 | 32 ft: wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest |
| H-56442__autocad | autocad | ✅ 1/8" = 1'-0" (title block) | 0/0/32 of 32 | 0 / 1859 | -100.0% | 2606 | 1859 ft: the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes |
| H-64361__clip | clip | ✅ 1/8" = 1'-0" | 29/2/1 of 32 | 1459 / 1622 | -10.1% | 171 | 62 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-72280__revit | revit | ✅ 1/8" = 1'-0" | 13/7/5 of 25 | 871 / 1263 | -31.0% | 97 | 149 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-80199__revit | revit | ✅ 1/8" = 1'-0" | 17/3/4 of 24 | 866 / 1046 | -17.2% | 37 | 75 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-88118__plot-black | plot-black | ✅ 1/8" = 1'-0" | 26/6/1 of 33 | 1545 / 1875 | -17.6% | 40 | 145 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-96037__skia | skia | ✅ 1/8" = 1'-0" | 37/3/1 of 41 | 2250 / 2494 | -9.8% | 68 | 129 ft: wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing |
| H-103956__clean | clean | ✅ 1/8" = 1'-0" | 30/1/0 of 31 | 1664 / 1778 | -6.4% | 32 | 55 ft: wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing |
| H-111875__shx | shx | 🟡 declined, wrong reason | 27/1/4 of 32 | 1391 / 1834 | -24.1% | 50 | 216 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-119794__autocad | autocad | ✅ 1/8" = 1'-0" (title block) | 0/0/37 of 37 | 0 / 2296 | -100.0% | 2585 | 2280 ft: the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes |
| H-127713__revit | revit | ✅ 1/8" = 1'-0" | 21/3/2 of 26 | 1012 / 1206 | -16.1% | 32 | 72 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-135632__plot-black | plot-black | ✅ 1/8" = 1'-0" | 22/1/4 of 27 | 852 / 1254 | -32.1% | 46 | 215 ft: wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing |
| H-143551__revit | revit | ✅ 1/8" = 1'-0" | 24/4/0 of 28 | 1152 / 1363 | -15.5% | 46 | 98 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |
| H-151470__half-archB | half-archB | ✅ 1/16" = 1'-0" | 20/1/5 of 26 | 810 / 1065 | -23.9% | 39 | 144 ft: wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous |

Total: 20970 of 32655 ft (-35.8%); wrong-but-confident scales: 0.
