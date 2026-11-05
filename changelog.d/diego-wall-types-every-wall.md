### The partition legend reads itself: no customer has to find a button for walls to get a type

**Why every untagged wall was untyped.** The WALL_LEGEND stage only ever started from a button
that appears after a reading pass finishes. A set nobody pressed it on had no legend, so every
wall's type had to come from a tag printed beside it, and the held-out new-build sets measured
0% typed. A customer who uploads a set and finds the walls would get the same.

**The fix.** The legend read is queued by itself (`lib/plan-ingest/legendAutoStart.ts`) at two
moments:
- when a set's free inventory pass closes, for every new upload;
- when the takeoff page opens on a set inventoried before this change.

**Conditions.** Only with the company's plan-reading AI on, because the read is a metered model
call per legend page, like the button's. It happens once per set. A set with a stored legend, or
that has ever had a legend run (finished, failed or under way), is left alone. The cron drain
reads it with no page open, and a failure here never stops the inventory run from closing.

**U.N.O. notes.** Already on main and unchanged. The `wall-legend.2` prompt returns the "all
interior partitions are type A" sentences as `uno`, and the stage stores them. They type walls
once the company's library holds the type they name.

**Tests.** `legendAutoStart.dbtest.ts`:
- nothing is queued with AI off, or before the set is inventoried;
- one run with a task per page, and never a second;
- the run is queued when an inventory closes.

Removing the close hook, or the AI check, turns a test red.
