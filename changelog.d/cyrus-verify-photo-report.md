### The GPS the GC does get, which is not the one #252 argued about (Cyrus) — AUDIT, docs only
`cyrus/verify-photo-report`

Docs-only under the audit exception (working agreement 1, granted
2026-09-07): this records what an investigation established and eliminated
about PR #252, so the next person does not re-run the same checks. No
code changed.

**#252's central privacy claim is true about the database and not true
about the photograph.** The PR argues at length, in four numbered grounds
across the portal `select`, the report projection and its own description,
that the GC does not get coordinates. Every word of that is correct as far
as the columns go, and it was verified three ways rather than read:

  - `PortalJobPhoto` has no coordinate field, `loadSharedJobMediaForClient`'s
    explicit `select` does not fetch one, and the mapping does not set one;
  - `JobPhotoReportCapture` likewise, and its dbtest pins the key set at
    exactly nine keys — so even `?include=everything`, the printed document
    that leaves the app entirely, carries no position;
  - `grep` for the three column names across the repo returns ten files and
    **not one of them is a portal, share, esign or export path**.

**What none of that reaches is EXIF.** There is no EXIF handling anywhere
in this repo — `grep -rni 'exif|sharp|piexif'` over `apps/web` and
`packages` returns nothing. `JobMediaCapture` hands the raw `File` to
`upload()` unmodified, so the object in the blob store is the camera's own
JPEG, byte for byte. `PortalJobPhotos` then renders that exact URL twice
over: as `<Image ... unoptimized>`, which means even the thumbnail is the
original bytes rather than a Next-resized derivative that would have
dropped the metadata as a side effect, and inside an
`<a href={blobUrl} target="_blank">` — an explicit invitation to open the
original file.

So a GC who saves a shared photo gets `GPSLatitude`/`GPSLongitude` at full
EXIF precision, finer than the five decimals #252 rounds to precisely
because five is the privacy hedge, alongside `GPSTimeStamp` and the device
make, model and often serial. The disclosure the PR refused on four grounds
travels inside the pixels instead of beside them.

**This is older than #252 and is not its bug** — photo sharing shipped in
#195 and the hole has been open since. #252 is where it became worth
writing down, because #252 is the change that states the guarantee. A
structural fence around three columns reads as a guarantee about
coordinates, and it is a guarantee about columns.

**The measurable part and the inferred part, kept apart.** Verified here by
reading and grep: no EXIF code exists, the raw `File` is uploaded, the
portal serves that URL. NOT measured from this container, which is
proxy-denied for the blob host: whether any particular capture's file
actually carries GPS tags, since that depends on the phone's own settings
and on iOS's photo-picker behaviour. One measurement settles it and needs
no credentials — `exiftool` on any photo downloaded from a portal link.

**Eliminated, so nobody re-checks:** `/api/export` and `/esign/[token]`
touch no media at all; the report's unrecognised-`?include=` fallback is
`shared`, not `everything`; `/jobs/[id]/photo-report` really does call
`requireCapability("MANAGE_FIELD")` in the page body, so the
`PAGE_ONLY_CAPABILITY` entry is a census row backed by an enforced guard
rather than the written-documented-never-called shape.

**Also established about the merge, since a green PR is not a green merge.**
CI run `34666863503` has head SHA `df6b476` and `gh pr view --json
headRefOid` agrees, so the check-the-SHA rule passes literally. It was a
`pull_request` event on 2026-09-12T02:09Z and **six PRs have merged to main
since**, so what CI actually tested was the branch against a base that has
moved. Merging the current `origin/main` into `df6b476` locally is clean —
no conflicts — and the result typechecks, lints with zero errors and runs
145 files / 2514 tests green, which is the evidence the SHA rule does not
itself provide.

**One pre-existing inconsistency noticed in passing, not #252's:**
`JobMedia` has no `onDelete` on its `Job` relation, so it is RESTRICT by
default, and it is absent from `HANDLED_MODELS` in `scratch-scope.mjs` —
while both `clean-scratch-data.mjs` and `seed-demo.mjs` do delete it in
their `del(...)` order. The effect is a false alarm from `blockingTables()`
rather than a silent failure, which is the safe direction, but it is the
#227 shape wearing the opposite sign.
