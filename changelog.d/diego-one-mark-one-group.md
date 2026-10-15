### Four groups were blue, and two of them weren't in the panel

From the same West Herr click-through. The sheet returned **19 thickness
groups**; the overlay colours them `CLUSTER_COLOURS[index % 6]`, so

| colour | groups drawn in it | rows in the panel |
| --- | --- | --- |
| `#38bdf8` | 0, 6, 12, **18** | only 0 and 6 |
| `#f472b6` | 1, 7, **13** | only 1 and 7 |

Two separate defects wearing one symptom.

### One: the overlay drew groups the panel does not list

`<FoundWalls clusters={found} …>` drew all 19. The panel lists `shownGroups`,
which is `found.slice(0, SHOWN_AT_FIRST)` — twelve. So **seven groups had lines
on the drawing and no row beside them**, wearing the colours of rows 1 to 6. A
reviewer looking at a blue line could not tell whether it was row 1's wall, which
they can accept, or row 13's, which they could not even see.

That matters more than it sounds. The overlay is the verification channel for
this whole feature: `wallVectors.ts` returns centrelines rather than a number
precisely so that a wrong answer is a line sitting where there is no wall. **A
line nobody can attribute breaks exactly that.** The overlay now follows the
list, so "Show the other 7" reveals the rows and their lines together. Nothing
actionable is lost — those lines were visible and unusable.

### Two: a colour was never enough to be a mark

A mark is now a colour **and** a dash — six colours times three dashes gives
**eighteen** distinct marks, so the twelve rows the panel opens with are all
distinct. That number had to be true and was not: `SHOWN_AT_FIRST` was
deliberately *twice* the palette, which is the point at which rows 1 and 7 are
the same blue on the first screen.

The panel's swatch was a 12px coloured square, which can only ever carry half of
such a mark. It is now a 16px line drawn by the same function as the overlay —
same colour, same dash ratios. `ClusterMark` is a component rather than inline
markup so a test can render it beside `FoundWalls` and compare; a decision inside
JSX is a decision no test can reach.

### And it still runs out, which the panel says rather than hides

Eighteen is not nineteen. A finite palette cannot label an arbitrary number of
groups, and claiming it can is the failure the template filter's message was
corrected for earlier the same day. Expanded past the marks, the panel says which
rows repeat one and that hover is the discriminator — hover thickens a group
2.5× and fades the rest to a quarter, which no palette competes with.

### The client-boundary guard earned its keep

`markFor`, `DISTINCT_MARKS` and `SHOWN_AT_FIRST` started life exported from
`TakeoffPlanViewer.tsx`, and `lib/client-boundary.test.ts` failed the build the
moment a test imported them: across the RSC boundary a non-component export of a
`"use client"` module arrives as a client-reference **proxy**, not the value. Its
message said to move them into a plain module and import from both sides, which
is now `lib/takeoff/clusterMarks.ts`.

### Verified

Preflight's four gates green, 699 test files, no production schema touched.

Seven mutations red: the overlay drawing `found` again, the truncation removed
instead (the same defect from the other end), the dash no longer cycling,
`SHOWN_AT_FIRST` raised past the number of marks, the swatch dropping its dash,
the swatch painting every group one colour, and the repeat warning made
unreachable.

That last one **was green at first** — the assertion checked the sentence was in
the file, and a mutation replacing `showingAll` with `false` left it there,
present and unreachable. Exactly the weakness #773 was caught by hours earlier.
It pins the whole gate now.
