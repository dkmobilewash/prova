### The types table scores what the WALLS stage posts: one grouping function for both, the product's runs, the sibling sheet, and a coverage report (Diego)
`diego/type-table-parity`

The C3 held-out test exposed sheets the types table could not see. Diagnosed for coverage only;
no held-out type number was read:
- Substation's key types every wall U, and MDR's holds openings only, so neither has a code to
  score.
- Lake Sahoma's and Mack's codes are only on walls traced by hand that the product's finder never
  detects (a detection gap).
- The real gaps were in the table itself. It grouped the finder's raw runs, not the runs the
  product offers (after the set-asides and, for a new company, the demolition compare). It also
  skipped the WALLS stage's text-legend guard (`wallTagCodes`), and never read the sibling sheet
  the stage reads for a sheet that prints no tag (Green Bay A3.1 from A3.2).

The fix is one function, `stageTypeGroups`, that does the grouping, the guard and the sibling read.
Both `detectWallsForCalibration` and `zzTypeTable.eval.ts` call it, so the product's behaviour is
unchanged and the table cannot drift from it. The table now groups the product's offered runs,
and writes `<out>.coverage`: every labelled sheet, scored or not and why. `measure.py` prints
`typed` (all key-code ft) beside `keyft` (the ft some run covers), so "the key types nothing"
and "the product found no run there" read apart.

Training, labels-snap-20261114T0204, old table → this table:

| `LEGEND_TEXT_RECALL` | settled-correct | wrong-of-typed |
| --- | --- | --- |
| on | 38.9% → 40.0% | 11.2% → 10.3% |
| off | 38.4% → 39.4% | 23.0% → 22.0% |

Green Bay 326 → 463 ft correct (it now reads A3.2). Held-out numbers measured with the old table
under-cover; re-measuring is the original's call.

C4 (the tag vocabulary: dotted codes, a legend that does not fit the sheet, codes no type carries)
was built behind a gate and FAILED its pre-registered training test (settled-correct 40.0% → 34.6%;
UCCS lost its legend). It is not in this change.

The check: `stageTypeGroups.test.ts`. It covers the sibling being asked only when the sheet prints
no tag, never on a scan or the finder's own grouping, a code printed beside a wall surviving the
guard, and both callers calling the one function.
