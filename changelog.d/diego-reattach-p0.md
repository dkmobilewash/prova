### A finder change never resets a contractor's wall decisions

A sheet's walls are deleted and re-created whenever the finder runs again: adding a work area or exclusion, or re-running the whole set. A person's kept and dropped came back only on an exact (1e-9) coordinate match, and runs typed by hand never came back. So after a deploy that moved a run's end, a dropped wall went back on the estimate. In the plan viewer, Keep/Drop on a moved run changed the screen and wrote nothing. Set type on a moved run wrote the wall a second time, so it was counted twice.

- One matcher, `sameWallRun` (runMatch.ts), is used by the refresh, the viewer and Set/Clear type. Two runs are the same wall when they are within 5°, within half the wall's thickness (at least 0.35 ft) of each other's line, and overlap by 60% of the longer one. Pairing is best overlap first, one to one. A collinear twin further along the line, the next wall over, and a stub on a long wall never match.
- Every kept, dropped or typed-by-hand row finds its wall again. One the new reading has no wall for is kept exactly as the person left it, and the sheet says it needs a look; this is worked out when the page loads, never stored. A reading that finds nothing no longer deletes a person's rows.
- Keep/Drop in the viewer never changes the screen without saving. On a sheet whose walls are on the job, a run with no stored row shows an error instead.

Door and window decisions were checked too. They are kept per sheet, and a re-run never replaces a sheet that has been decided. No schema change.
