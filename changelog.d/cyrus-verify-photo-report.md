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

**The merge into `cyrus/integration` is where the conflict count lies to
you.** `cyrus/integration` is the branch the demo is filmed from and it
carries the dark-palette rebuild. `git merge-tree origin/cyrus/integration
df6b476` reports exactly two conflicted files — `app/(app)/photos/page.tsx`
(two hunks) and `components/JobMediaSection.tsx` (one hunk) — and every one
of those three hunks is the same collision: #252 writes `text-blue-400`,
`text-slate-100`, `text-slate-400` where the rebuild has already put
`text-link`, `text-ink`, `text-ink-body`. Those are the easy half. They
conflict because both branches edited the same lines, so a human is forced
to look at them.

**The half that needs saying is the half that does NOT conflict.** Three
more files auto-merge clean and carry raw palette classes in with nothing
on screen to say so: `JobMediaCard.tsx` (`text-slate-400`, `text-blue-400`,
`text-blue-300`), `JobMediaCapture.tsx` (`text-slate-400` ×3), and
`jobs/[id]/photo-report/page.tsx` — a **brand-new file**, which is why it
cannot conflict with anything, carrying twelve. Counted on the merged tree
git actually produces, not on either parent. So "two conflicts" is the
measure of what git noticed, and the palette regression is four files wide.

**Nine of the photo-report page's twelve are violations and three are
not**, and blanket-converting all twelve would break the feature. Lines
134, 135, 142, 147, 148 and 201 are app chrome on the dark canvas and want
tokens. Lines 211, 278 and 313 — `border-slate-300`, `bg-white text-black`,
`bg-slate-100`, `text-slate-600` — are inside the printable sheet, which is
deliberately white paper because it is a document somebody hands to a GC. A
rebuild that tokenises those ships a dark-grey PDF.

**Item by item, what the other checks returned.** The migration is additive
and then some: `grep -c 'CREATE TABLE'` and `grep -c 'FOREIGN KEY'` on
`20260911150000_add_job_media_location/migration.sql` both return **0**. It
ALTERs one existing table, adds three nullable `DOUBLE PRECISION` columns
and two CHECK constraints, applies no default and rewrites no row. **No new
model means no new RESTRICT child**, so the #227 three-edit rule
(`HANDLED_MODELS`, both `del(...)` orders) has nothing to do here —
confirmed rather than assumed by `lib/scratch-cleanup-order.test.ts`, the
strengthened #229 version that asserts its parsed FK count against an
independent count of the literal string, passing 14/14.

**CI, asked for its jobs rather than its colour.** Run `34666863503` is on
`df6b476`, which equals `headRefOid`; `GET /actions/runs/34666863503/jobs`
returns **two** jobs, `ci` and `dbtest`, both `success`, both
`head=df6b476`. The second one matters here specifically: #252's privacy
guarantee is asserted in `job-media-location.dbtest.ts` (lines 499-504,
`JSON.stringify(photos)` must not contain the digits or the key names), and
`.dbtest.ts` files are the class CLAUDE.md records as once having had no
runner at all. They have one now — a separate `dbtest` job on a scratch
Postgres 16 that runs `migrate deploy` first, so the two CHECK constraints
are validated on every PR as well. The guarantee is enforced, not merely
written.

Re-measured today rather than inherited: main has gained **11 commits**
since the PR's merge-base `4c8fe18`, so the `pull_request` run tested a
base that has moved. Merging current `origin/main` into `df6b476` locally
is clean, and the merged tree gives typecheck clean, lint zero errors (six
pre-existing `no-unused-vars` warnings, none in #252's files), and
**145 files / 2514 tests passed**. #252's own five touched test files are
212 tests, all green.

**The demo seed has no photographs at all, so there is nothing to film.**
`seed-demo.mjs` mentions `jobMedia` on exactly one line — line 1376, a
`del(...)` in the teardown — and creates none. There is no annotation seed
either. A photo report is therefore a hand-staged demo: upload captures,
draw the marks, and share them, because the report's default selection is
`shared` and a bare `/jobs/<id>/photo-report` on an unshared gallery prints
an empty document. That default is the right one and it is the thing most
likely to be mistaken for a bug on camera.
