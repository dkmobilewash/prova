### Photos are pinned to OUR blob store, not to any Vercel one — #195's last open item (Diego)
`claude/prova-vercel-direct-url-hg1acx` → #219

`recordJobMedia` checked the SHAPE of a URL — a blob host, a path under
this job — and **anyone can create a Vercel blob store and choose any path
inside it.** A caller who knew a job id could put `job-media/<jobId>/x.jpg`
in their own store and post that URL: every existing check passed, because
all of them were about the path, and the path is exactly what an attacker
with their own store gets to pick.

**The harm is not the picture.** Such a caller could already upload a bad
image legitimately. It is that the row pointed at a host we do not control
— whose content can change *after* anyone reviewed it, and whose every
render is a fetch carrying the viewer's IP. #214 made that audience include
the GC, since `loadSharedJobMediaForClient` hands `blobUrl` to
`/portal/[token]`.

`isOurBlobStoreUrl` compares the hostname's first label against the store
id, and **the id needs no new setting** — it is already inside the
credentials the app holds. `blobStoreId()` reads it the same two ways the
SDK does: `token.split("_")[3]` for `vercel_blob_rw_<storeId>_<secret>`, or
`BLOB_STORE_ID` with a leading `store_` stripped under OIDC.

**Both are accepted deliberately.** Reading only the token is correct today
and would fail CLOSED — no uploads recordable at all — the day a deployment
moves to OIDC, which `resolveBlobAuth` already supports. A guard that
silently turns a working feature off when the platform changes underneath
it is worse than the gap it closes.

It fails closed with no derivable store id, which is the safe direction:
without credentials the upload route cannot mint a token, so no legitimate
URL exists to record. Existing rows are untouched — `deleteJobMedia` deletes
by stored URL and does not re-validate.

52 → 64 test cases, counted rather than taken from the commit message,
including a URL from another store that passes both existing checks and is
refused by this one. Three mutations run, each reddening its named tests,
file restored byte-identical.

**Not clicked**, and a wrong derivation fails closed, so the first upload on
production is the check that matters. Note this closes the provenance half
of the blob question only: the Preview store itself does not exist yet, so
previews still write into production's bucket until Diego creates one.

_Entry written after the merge by a different session — #219 shipped before
`changelog.d/` existed, so it had nowhere to put one._
