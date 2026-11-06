### The review queue never asks a price for "Walls — untyped"

**What happened:** since #1010 a confirm writes the lines of the items it touches, and that includes "Walls — untyped", whose remaining runs get an unpriced "(no type: check)" line. The queue asked a price for it, so a confirm that took one item off put one back, and the count stood still (fast-confirm on a local run; walk v3's finding 3 again). CI passed only when its assertion ran before the refresh.

**Fix:** those runs are the queue's type items, and their line goes when the last of them is typed, so they get no price item. fast-confirm now checks the count from the server, after the line exists.
