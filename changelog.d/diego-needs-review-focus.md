### Needs review points at its runs: hover one to see it on the plan, click its length to go there

Item 12 of Chrome's click test on Baker A101, which arrived cut off after #965.

- In the layer panel's **Needs review** row, pointing at a held run draws it on the plan in wide amber.
- Clicking its length ("12 ft") zooms the plan to it and centres it. This is the same `viewOfRun` view the wall review uses.
- "It is a wall" is still its own button, so going to look at a run never confirms it.
- The takeoff tab, which has no zoom to offer, keeps the length as plain text.

Check:
- `takeoffHeldWalls.test.tsx`: hover reports the run and leaving reports none; a click asks to be shown and confirms nothing.
- Click-list R5-3b, on a Baker sheet with held runs: the highlight appears on hover and goes when the pointer leaves, and the length click changes the zoom and puts the run's middle inside the canvas.
