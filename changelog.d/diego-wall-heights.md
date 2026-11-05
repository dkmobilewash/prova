### Wall heights and square feet in the takeoff screen, with where each height came from

Read from what is stored today; no model is asked anything and there is no migration.

- **Every wall layer row and every Quantities group row** read `65 ft × 14'-0" × 2 sides = 1,718 sf` (`lib/takeoff/wallHeight.ts`).
  - The height and sides are the group's takeoff item's: the item holding its runs on the sheet, which are the two figures the estimate prices at.
  - Openings come off by the company's own rule, through the estimate's `boardedArea`.
  - A group with no height reads `65 ft · no height`.
- **Where the height came from**, derived and never stored, by what the item's height equals:
  - `legend ZH1: "TO DECK"; A301 prints T.O. DECK 14' 0" → 14'-0"`: the type's default, with the chain the legend read wrote into its notes;
  - `ceiling plan, room 104 OFFICE: 10'-0"`: the ceiling over the rooms the group's walls bound, from saved rooms;
  - `typed: 9'-6"`: anything else.
- **Set height**, on a group with none:
  - its options are the ceiling, the type's legend height and a typed figure (`10'-0"` or `10.5`);
  - one press saves it on the group's item for the whole job (`setWallGroupHeight`), giving the item 2 sides if it had none;
  - once takeoff lines are on the estimate, that item's lines follow at once.
- **The review queue** gains a fifth kind, between untyped groups and scales: a wall item (typed, or "Walls — untyped") with no height. It shows on the sheet holding most of its length, with the same Set height.
  - After a plain takeoff, "Walls — untyped" is therefore one more item to review.
  - After Set type, the type's item is one more item to review if the type has no height.
- `e2e/specs/wall-heights.spec.ts` sets one group from the legend, one typed and one from the ceiling via the queue. `review-queue.spec.ts` now walks the height item too.
