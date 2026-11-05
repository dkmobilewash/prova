### "Use the printed scale on all N floor plans", listed before it applies (new-customer run v2, M1's last piece)

On Baker, the floor plans the scale reader could not confirm (A100 and A101) each needed their own "Use the printed scale" press.
- The "Floor plans that need a look" box now offers **Use the printed scale on all N floor plans** whenever two or more have only a printed scale.
- The first press only **lists** them, each with its scale and a sentence saying nothing on the sheets confirms it. **Set these N** applies, and **Cancel** changes nothing.
- It goes through `confirmSheetScales(…, usePrinted)`, which now takes several pages.
  - Each sheet is saved as its own one-click fix would save it: the same note, and the wall finder started.
  - A sheet that already has a scale is skipped, so each is set once and nothing changes silently.
- `plan-set-scales.spec.ts` checks:
  - the list names the two sheets at their scale, and neither list nor Cancel writes anything;
  - the apply sets each sheet exactly once;
  - the button goes when nothing printed-only is left.
