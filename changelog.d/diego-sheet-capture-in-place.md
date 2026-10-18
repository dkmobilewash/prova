### A photo and the pin it was taken for are one request (Diego)
`diego/sheet-capture-in-place`

No migration. Three fields on an op, a branch in the media route, and a button.

Tap a spot on the sheet, press **Photo here**, shoot. The photo is saved and
pinned at that point, in one act, offline or not. A foreman at the wall has not
written anything yet — he has SEEN something — which is why this button sits
above the note field rather than beside it.

**ONE REQUEST IS NOT A PREFERENCE. THE QUEUE FORBIDS THE ALTERNATIVE.** The
drain runs its ops INDEPENDENTLY and deliberately: it skips a not-yet-due op
and carries on, and its own comment says why — *"a day of time can sit behind
a photo. OFF-32: never drop time, and never let it be blocked behind something
else."*

So there is no way to say "this pin after that photo", and building one would
fight the scar that rule exists for. Two ops is not a slower design, it is a
**broken** one:

  - the pin could send first and have no photo to point at;
  - or the photo could be refused — a 413, or a file the system cleared out —
    while the pin goes through and points at nothing.

The photo and its pin are therefore made by one request, in one transaction, or
neither is made. The route reuses the same `pinPlacementProblem` the web uses,
from the same module, so a pin dropped on a phone cannot land somewhere the web
would have refused — and the sheet is checked against the job exactly as the
daily report and the punch item already are, because a sheet id from another
job is a bug or a probe either way.

**It follows the pattern the app already had**, rather than inventing one:
`/photos/[jobId]?punchListItemId=…` already opens the camera carrying an item,
and *"the camera screen attaches the photo to THIS item at the shutter"*. This
adds `sheetPageId`, `pinX`, `pinY` to the same door.

| mutation | result |
| --- | --- |
| control | green |
| the upload stops sending the sheet page | **RED** |
| the op stops carrying the position | **RED** |
| the sheet stops carrying the point to the camera | **RED** |
| the camera drops it before the upload | **RED** |

**THE TEST'S FIRST PREMISE WAS TOO STRONG AND THE FIRST RUN CAUGHT IT.** It
asserted that no queued op may carry a `mediaId` at all. That is wrong:
pinning a photo **already on the server** has no ordering problem and is a
reasonable thing to build later. The invariant is narrower — it is the CAPTURE
that must not split, because a photo being taken right now does not exist yet.
Written as the broad rule it would have blocked a feature for a reason that
does not apply to it.

The numeric census earned itself again: `Number(formData.get("pinX"))` was
refused, and rightly — this route answers whoever posts to it, `Number("")` is
0, and a pin at a silent zero lands in the sheet's top-left corner looking
deliberate.

587 files / 9091 tests on the web, 44 / 360 and 16 / 78 on the phone, lint,
build and preflight clean. **Unverified on a device** — and build 15 is still
sitting in EAS's submission queue, so three mobile changes are now stacked
behind it.
