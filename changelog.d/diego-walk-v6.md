### A new company reaches the title blocks again, and Accept all takes the drawing's wall height (Diego)
`diego/walk-v6`

Walk v6 on Baker, a fresh company with AI plan reading on (the default since #1023), found two
defects on the path to a sent bid:

- **"Read the title blocks" never appeared.** The wall legend queued behind the free pass
  ran (#1025) and took the reading panel's view, and the title-block offer was keyed on the
  view's stage. A reload did not help, because the newest reading run was the legend. The
  offer now has its own state, and the panel's reload view leaves the legend out, as it
  already leaves out the whole-set walls and scanned-sheet runs.
- **Accept all wrote the ceiling's 10'-0" where the walls run to deck at 15'-0".** The
  set's sheet-wide height was stored only when the legend's types first reached the
  library, which on a new company is Accept all itself. So the queue's first screen offered
  "ceiling plan, room 106: 10'-0"", and C8B, S6A, S8B and S8C went onto the bid at 10'.
  The legend read now stores the sheet-wide height and level marks when it saves its
  proposal.

Checks: `planIngestAutoStart.test.tsx` (two new cases), `readingPanelExcludes.test.ts` and
`legendStoresGeneralHeight.test.ts`; each fails with its fix removed. The local walk spec
now confirms the windows count, records what Accept all is offered at, checks its Undo once,
and lists the typed items' stored heights.
