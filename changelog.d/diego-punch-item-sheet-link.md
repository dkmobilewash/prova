### A pin you cannot find from the item is write-only (Diego)
`diego/punch-item-sheet-link`

No migration. One relation on a query, one link on a row.

#650 made it possible to put a punch item at an exact point on the contract
drawing. **Nothing could then find it.** You could mark where item 14 is and
have no route back to it from item 14 — the half of a link that gets built last
and often not at all, because the person who adds the pin already knows where
it is.

The punch list row now says **"on A-201"**, linking to the drawing. Beside the
`area` it is replacing, not instead of it: `area` is free text — *"Level 3
corridor"* — and an item raised before anybody pinned it has only that, while
an item raised ON the drawing has only the pin. Both show while both exist.

`take: 1` on the relation is the unique index restated rather than an
optimisation. An item has ONE location; if that ever became many, this row
would have to decide which to show, and silently showing the first would be
wrong.

**The label prefers the sheet's own.** `"A-201"` is what a person calls it;
`"sheet 14"` is what the PDF calls it, and only one of those is any use on a
job. The number is the fallback for a set whose title blocks have not been
read.

| mutation | result |
| --- | --- |
| control | green |
| the link removed (the pin goes write-only again) | **RED** |
| the free-text `area` dropped | **RED** |
| the query stops loading the pin | **RED** |

The census says in its own header that it is a PRESENCE census: it cannot prove
the link renders or that the href resolves, only a browser does that. What it
stops is the query being trimmed back by somebody who greps for `sheetPins`,
finds one reader, and concludes nothing needs it.

586 files / 9086 tests, typecheck, lint, a full production build and preflight
clean. **Not clicked yet.**
