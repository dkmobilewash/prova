### The takeoff workspace on an iPad: pinch, two-finger pan, 44px taps, drawers and the queue by tap

Contractors use iPads on site. Tested at 1180×820 and 1024×768 with touch, and fixed:
- **Pinch zooms the drawing, and two fingers pan it,** about the point between the fingers. It is the same smooth preview as the wheel, committed once when a finger lifts. One finger stays the tool's.
  - The frame takes `touch-action: none`, so the page itself never zooms.
  - The listeners are in the capture phase: in the bubble phase the drawing's own handlers saw the touches first and nothing zoomed.
- **A zoom with the review queue open no longer snaps back.** `setPageSize` made a new object on every render at a new zoom, which re-fired the queue's zoom-to-item. That snapped a pinch, and a wheel zoom too, straight back. The same size now keeps the same object.
- **Every control in the workspace is a 44px tap target on a touch screen** (`pointer: coarse` only; a mouse keeps today's density). Measured before: 41 controls at 26–36px — the tool rail, zoom, sheet pager, the queue's Accept, codes and Next.
- **The bottom-left HUD on touch:** the notices box clears the taller zoom bar, and the "This sheet" card moves to the bottom-right. They had sat on one another.
- **The review queue's key hints** ("Enter accept · 1–9 type · T height · N skip") show for a mouse only. On a tablet every key is a button already: Accept, the numbered codes, Next, the height box.

`ipad-workspace.spec.ts` covers both sizes: tap targets, the HUD not overlapping, pinch with the queue open, two-finger pan, the rail by tap, the items and layers panels as drawers, and the queue answered by tap.
