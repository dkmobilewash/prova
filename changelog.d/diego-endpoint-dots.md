### Endpoint dots and handles stay one size on screen at any zoom

Each end of a run, each count mark, each corner handle in Edit, and each door hinge and demolition-door ring had a radius in page units. The overlay's viewBox is the page, so they grew with zoom: at high zoom each end of a run was a disc tens of pixels across, covering the drawing it marked. They are now sized in screen pixels (`onePx = 1 / cssWidth`), the same way the trace tool's snap ring already was, at the size each had at fit width.

Check: `takeoff-workspace.spec.ts` 13g reads a draft's endpoint dot at fit and after four zoom-ins. They must match within 1px. With the old radius restored it goes red: "the dot grew with zoom: 9.9px at fit, 31.1px zoomed in".
