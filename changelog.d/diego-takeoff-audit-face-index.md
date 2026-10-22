### One linear scan was sixty seconds of a real sheet

`oneFacePerLine` groups drawn segments onto the lines they are pieces of, and
it did it with `lines.find(...)` — a scan over every line found so far, once
per segment. On Camp Bow Wow A101 that is 425,057 segments against a list that
grows to 299,616: about 6×10¹⁰ comparisons and **60.0 seconds**, which was the
whole of that sheet's time before it refused.

| sheet | before | after | faces out |
| --- | --- | --- | --- |
| A101 | 60,023 ms | **515 ms** | 299,616 → identical |
| A102 | 4,998 ms | **155 ms** | 62,954 → identical |

Indexed on the two things the predicate tests — direction and perpendicular
offset — with the original predicate still applied to every candidate, so the
index only decides what is worth testing. Insertion order is preserved by
taking the lowest index among candidates, because `find` returned the first
match and which line a piece joins decides what gets merged. Nothing is
allocated per segment: the spatial index written for `curvedWalls` was ten
times *slower* than the scan it replaced because it built a Set and sorted on
every step.

**The direction wrap, and a test that proved nothing.** Directions fold into a
half turn, putting vertical at both ends of the bucket range. The first test
written for that was vacuous and passed with the wrap deleted — one vertical
face drawn up and one drawn down normalise to the same bucket and never reach
it. What reaches it is a pair straddling vertical, 89.5° and 90.5°, through the
origin so their offsets match. Not a corner case: without the wrap A101 yields
317,924 faces instead of 299,616, six per cent of them lines that failed to
meet the rest of themselves.

**A101 still refuses, and raising the budget is not the fix.** It goes from
47.9 s to 2.3 s and then declines at 12,179 pairable lines. Raising
`MAX_PAIR_TESTS` was tried and timed out at twenty minutes — the pairer is
O(n²) with `inAHatchSeries` scanning inside it, so about 10¹² at this size. The
budget is the only thing stopping a hang. Fixing it means indexing `order` the
same way, for both the partner search and the hatch-series scan; that is its
own pass.

Guards unchanged: twenty fixtures 13 of 17 within 2%, bench identical, every
real-sheet footage identical. The whole real-plan run went from 87 s to 43 s.
