### "Run the takeoff" opens on a floor plan, never a numberless cover (fix to #996)

The fourth session's walk on main 66eeca59 found it. On Baker, with all three floor plans scaled, "Next: Run the takeoff ↗" opened the workspace on page 5, a COVER sheet with no sheet number, where Run takeoff is disabled.

- **Why:** #996 asked which sheets the whole-set run would count *as if every sheet had a scale*. The run skips a numberless cover only for having no scale, so with the scale forced the cover counted, and page 5 came before A100 and A101.
- **Now** (`floorPlansOfTheWork`, in `walls.ts`) the question is still "as if every sheet had its scale", but only sheets the plan set files as floor plans count.
  - The workspace opens on A101 whether or not it is scaled.
  - It never opens on a cover.
  - It never opens on the overall plan just because that one has the only scale so far. Trying "the run's own count first" opened A100 in exactly that case, and `open-the-work.spec.ts` caught it.
- **Test:** `floorPlansOfTheWork.test.ts` covers a cover before A100 and A101: unscaled, scaled, only the overall plan scaled, and with the cover scaled.
