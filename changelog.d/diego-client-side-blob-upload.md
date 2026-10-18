### A file on a Server Action is capped at 1MB, and no drawing is that small (Diego)
`diego/client-side-blob-upload`

No migration. One route, two action signatures, and a census.

**FOUND BY DIEGO ON THE FIRST REAL DRAWING, which is the only way it could have
been found.** #636 shipped PDF upload and it failed on the first file he tried,
saying *"That file could not be read as a PDF."* The file was a perfectly good
PDF. Two separate defects, and the second one is why the first took any time at
all:

**1. The ceiling is not ours to raise.** The PDF was posted to a Server Action
as FormData. A Next Server Action body defaults to **1 MB**, and Vercel caps a
serverless request body at **4.5 MB** whatever Next is configured to allow. A
single architectural sheet is bigger than that; a set is 10-100MB. **There is
no value of `bodySizeLimit` that makes that shape work.** The runtime log is
what settled it: there is no POST at all for the attempt — the request never
reached a function.

`upload()` from `@vercel/blob/client` sends the bytes straight to blob storage
with a short-lived token minted by `/api/drawings/upload`. The action that
follows carries only a URL.

**2. THE ERROR NAMED THE WRONG HALF, AND THIS REPO HAD ALREADY PAID FOR THAT
MISTAKE THE SAME DAY.** The browser wrapped the PDF read AND the upload in one
try/catch, so a refused upload reported itself as an unreadable file. The
identical defect was found and fixed in `sheetPins.ts` that morning — the
changelog entry for it says *"a catch around two different operations tells you
which one failed only by accident"* — and it was reintroduced in the component
within the hour. Three operations, three messages now, and the upload failure
passes the route's own sentence through rather than flattening it.

**What the token route checks**, because it is the only place an upload is
authorised: signed in, holds `MANAGE_JOBS`, and the revision named belongs to
the caller's own company. A URL is then accepted only if it came from **our**
store — `isOurBlobStoreUrl`, not `isBlobStorageUrl`, which proves merely "some
Vercel store". Without that the field takes any URL and the upload is a link
again, which is the thing this feature exists to stop.

| mutation | result |
| --- | --- |
| control | green |
| **the real revert — file back on the action** | **RED** |
| provenance check dropped | **RED** |
| an upload skips the token route | **RED** |
| token route stops checking the capability | **RED** |

The third of those first came back green, and the mutation had **not applied** —
the indentation in the replacement did not match. Re-run with the change
verified by a count, it is red. A mutation must be checked for having RUN, not
merely for being red; this file's own rule, caught by applying it.

**The census is narrower than the first draft of it.** It began by asserting no
`FormData` anywhere in the actions file, which is wrong: `createSheetPin` takes
one and should — a pin is two numbers and a short note, nowhere near any limit.
It asserts the two file-carrying actions specifically, and that no `File` is
handled in an action at all. A census aimed at the wrong set is this repo's most
repeated mistake, and the first draft of this one made it.

573 files / 8930 tests, typecheck, lint and a full production build clean.
**Not clicked yet** — the thing this fixes is something only a real drawing
through a real browser can show.
