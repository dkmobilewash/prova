### "Run the takeoff" opens on a floor plan, never a numberless cover (fix to #996)

The fourth session's walk on main 66eeca59 found it. On Baker, with all three floor plans scaled, "Next: Run the takeoff ↗" opened the workspace on page 5, a COVER sheet with no sheet number, where Run takeoff is disabled.

- **Why:** #996 asked which sheets the whole-set run would count *as if every sheet had a scale*. The run skips a numberless cover only for having no scale, so with the scale forced the cover counted, and page 5 came before A100 and A101.
- **Now** (`floorPlansOfTheWork`, in `walls.ts`):
  - the sheets the run actually counts come first; the "as if scaled" question is asked only when it counts none yet, so the workspace still opens on A101 before its scale is set;
  - in both cases only sheets the plan set files as floor plans are kept.
- **Test:** `floorPlansOfTheWork.test.ts` covers a cover before A100 and A101: unscaled, scaled, and with the cover scaled too.
