### A building drawn grey beside a dark plan is set aside, even when the sheet never says "existing"

Route 3 of `existingWalls` set aside grey walls only on a sheet whose words say it
shows existing work. Joplin G-101 and Camp Bow Wow A101 draw the building that
stands in grey beside new work drawn dark and never say so, so its walls were
offered as new.

Route 3b covers a sheet with no renovation words, and asks every other sign to
hold instead: the sheet's walls at least 75% dark by length, the wall at least
20 ft long (Topeka's short grey partitions are new), grey along 90% of it, and
grey on its OWN face lines. That last check is what K-4 A3.10 needed. Its new
walls are drawn black, with grey linework just off their faces; without the
check, 173 ft of real wall went.

Measured on labels-snap-20261110T0122, suggestions accepted. Training: 346 ft
junk / 0 ft real (Joplin G-101 282, Camp Bow Wow A101 63); renovation and new
build totals unchanged. Held-out, measured once: nothing moved on any of the 26
sheets, so USU and Riverbend, the sheets that prompted this, are not reached by
it.

Tests: existingWalls.test.ts, route 3b. Each mutation turns a test red: the route
off, the own-face check removed, the floor at 10 ft, the dark share at 0.4, the
grey cover dropped, the route allowed on renovation sheets.
