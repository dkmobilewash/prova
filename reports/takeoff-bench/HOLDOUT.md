# Holdout — run once, reported separately

20 seeded random plans (seeds in `holdout.ts`) built from the same partition types, junctions and export quirks. **A fix may be tuned on the main set; it must be validated here.**

| Case | Variant | Scale | Found/partial/missed of counted | LF found / key CL | Error | Phantom ft | Biggest loss |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H-1009__shx | shx | 🟡 declined, wrong reason | 29/1/1 of 31 | 1539 / 1618 | -4.9% | 80 | 60 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-8928__autocad | autocad | ✅ 1/8" = 1'-0" | 39/0/1 of 40 | 2002 / 2068 | -3.2% | 39 | 63 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-16847__autocad | autocad | ✅ 1/8" = 1'-0" | 26/0/0 of 26 | 1361 / 1387 | -1.9% | 30 | 29 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-24766__plot-black | plot-black | ✅ 1/8" = 1'-0" | 32/0/0 of 32 | 1947 / 1919 | 1.4% | 161 | — |
| H-32685__revit | revit | ✅ 1/8" = 1'-0" | 31/0/3 of 34 | 1470 / 1560 | -5.8% | 38 | 43 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-40604__shx | shx | 🟡 declined, wrong reason | 36/0/1 of 37 | 1672 / 1723 | -3.0% | 84 | 49 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-48523__clip | clip | ✅ 1/8" = 1'-0" | 28/0/1 of 29 | 1405 / 1426 | -1.4% | 18 | 28 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-56442__autocad | autocad | ✅ 1/8" = 1'-0" | 31/0/1 of 32 | 1793 / 1859 | -3.5% | 27 | 47 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-64361__clip | clip | ✅ 1/8" = 1'-0" | 32/0/0 of 32 | 1815 / 1622 | 11.9% | 98 | — |
| H-72280__revit | revit | ✅ 1/8" = 1'-0" | 23/0/2 of 25 | 1155 / 1263 | -8.6% | 9 | 45 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-80199__revit | revit | ✅ 1/8" = 1'-0" | 22/0/2 of 24 | 998 / 1046 | -4.6% | 27 | 22 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-88118__plot-black | plot-black | ✅ 1/8" = 1'-0" | 32/0/1 of 33 | 1831 / 1875 | -2.3% | 30 | 40 ft: only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor |
| H-96037__skia | skia | ✅ 1/8" = 1'-0" | 41/0/0 of 41 | 2466 / 2494 | -1.1% | 226 | — |
| H-103956__clean | clean | ✅ 1/8" = 1'-0" | 31/0/0 of 31 | 1760 / 1778 | -1.0% | 166 | — |
| H-111875__shx | shx | 🟡 declined, wrong reason | 32/0/0 of 32 | 1820 / 1834 | -0.7% | 76 | 32 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-119794__autocad | autocad | ✅ 1/8" = 1'-0" | 36/0/1 of 37 | 2239 / 2296 | -2.5% | 389 | 40 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |
| H-127713__revit | revit | ✅ 1/8" = 1'-0" | 25/1/0 of 26 | 1115 / 1206 | -7.5% | 65 | 83 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-135632__plot-black | plot-black | ✅ 1/8" = 1'-0" | 25/1/1 of 27 | 1182 / 1254 | -5.7% | 89 | 53 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — grid (S-GRID) |
| H-143551__revit | revit | ✅ 1/8" = 1'-0" | 28/0/0 of 28 | 1342 / 1363 | -1.5% | 21 | — |
| H-151470__half-archB | half-archB | ✅ 1/16" = 1'-0" | 25/0/1 of 26 | 1002 / 1065 | -5.9% | 24 | 53 ft: wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL) |

Total: 31913 of 32655 ft (-2.3%); wrong-but-confident scales: 0.
