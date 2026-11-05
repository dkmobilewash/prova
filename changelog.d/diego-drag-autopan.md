### A box dragged toward the edge of the plan keeps going: the plan scrolls under it

Diego's report: dragging a rectangle, an area or a highlight box toward the edge of the visible plan stopped at what was showing. The pointer could not leave the frame, so nothing past it could be reached.

- **Auto-pan.** While the button is down on a drag, the plan scrolls toward any edge the pointer is within 40px of, or past, faster the closer it gets. This covers a rectangle, Count like this's box, the answer key's selection box, Split area's line, a corner being moved in Edit, and a line or area being drawn with the button held.
- **The overlay holds the pointer** (`setPointerCapture`) for the whole drag, so leaving the plan for the panel does not drop the box.
- **The box follows any scroll.** After an auto-pan, a wheel turn mid-drag, or a Space-pan between clicks, the last pointer position is played back into the overlay. The far corner stays under the pointer instead of being left on the part of the sheet that scrolled away.

Check:
- `takeoff-workspace.spec.ts` 13f, in a real browser, zoomed in.
  - A rectangle held at the right edge scrolls the plan by more than 50px and ends past what was visible when the drag began.
  - A wheel turn mid-drag scrolls the plan and the box's corner follows it down.
- With the auto-pan loop switched off, 13f goes red ("holding the box at the edge did not scroll the plan").
