### The zero-touch bid error, broken into dollars by cause

`zzZeroTouch` v2 decomposes each group's bid error into ranked dollars: junk walls posted (new build), existing
walls counted on renovations, missed walls, board with no height assigned (LF × the heights key's per-type feet
× 2 sides — the whole term until heights auto-assign), doors not posted, windows not posted, and a residual.
Wrong type stays $0 by construction (one composite wall rate, and nothing posts typed with zero presses); the
canonical type scorer owns that gap in feet. Doors posted now count via `doorMarks` (the auto-post class).
