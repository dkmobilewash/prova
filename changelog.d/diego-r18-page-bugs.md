### The page asked for opens, and two sheets with one name are told apart (ROUND 18, Diego)
`diego/r18-page-bugs`

Reproduced on the Bluetooth set with plan reading off. It prints AI101 CONSTRUCTION PLAN twice (pages 6 and 7) and AI501 twice, and has no scale yet.

- `?page=7` opened page 6. The takeoff page knew only pages with a scale, so an unscaled page
  asked for was "no sheet" and the workspace took its own choice. Every page the inventory read
  counts now, for `?page=` and for Review's first item.
- The sheet picker offered "AI101 · CONSTRUCTION PLAN" twice, with nothing to tell them apart. A
  repeated label now carries its page: "AI101 · CONSTRUCTION PLAN (page 6)" and "(page 7)".
- One sheet number printed twice is one drawing. Nothing grouped the two AI101 prints (their
  title names no level), so a whole-set takeoff would have measured the same walls twice. The
  first print is kept and the second is "same level as AI101 (page 6)". A note naming a sheet
  number two sheets share now carries the page; page 7 would otherwise read "This sheet isn't
  counted: AI101 shows the same level", its own name.

Checked by `takeoff-r18-pages.local.spec.ts` on Bluetooth (mutations: without each fix its step
fails) and `walls.test.ts`.
