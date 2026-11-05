### Answer-key labels are keyed by the sheet number, never its title (Diego)
`diego/label-key-number`

Since sheet naming learned titles (#978/#982), the takeoff workspace handed
`"A101 · FLOOR PLAN"` to the labels route as the sheet number. Saved labels
stopped loading (Baker A101 showed 0 walls) and a save would have written a
near-empty `A101_FLOOR_PLAN.json` beside the real `A101.json`.

`labelSheetKey` (`lib/takeoff/labelRows.ts`) takes the part before the first
` · `. The route applies it on GET, on the overwrite guard and on the write, so
no client can name a file by title again; GET still reads a title-keyed file as
a fallback, and nothing writes one. The two workspace call sites pass the
number too. The check: `app/api/takeoff/labels/route.test.ts` — a titled sheet
loads `A101.json` and saves to it; reverting the server keying turns two of its
cases red.
