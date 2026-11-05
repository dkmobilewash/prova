### Answer-key labels saved under a page number still load, and save back to the same file (Diego)
`diego/label-key-page`

#990 keyed label files by the sheet NUMBER. Sheets labelled before any number
had been read for their page were saved under the page instead (`p74.json`),
so once the number appeared the labelling page asked for `A-101`, found
nothing, opened with 0 walls — and a save would have forked a second file for
the same sheet. Six such files are known (Topeka p74-p76, O'Reilly's p1,
Fulton Rd p2, HPL Lighthouse Bulletin 2 p3).

The route now resolves the file once, the same way for the read and the
write: the number, then `p<page>`, then the legacy title (read-only). A save
goes back to the file the page loaded, keeps that file's own `sheet` field,
and the overwrite guard reads that same file. A request without `page` (an
older client) behaves exactly as #990 did.

Check: `app/api/takeoff/labels/route.test.ts` — a `p74.json` loads for
`A-101 · FIRST FLOOR PLAN` on page 74, a save rewrites `p74.json` and creates
no `A-101.json`, the number wins when both exist, and no `page` means #990's
behaviour. Mutating the page step out turns three of them red.
