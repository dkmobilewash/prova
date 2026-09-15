### Every document upload was broken above 1MB, and the 15MB guard in front of it had never once run (Diego)
`claude/prova-company-cam-feature-6170v6`

Attach a real subcontract PDF, a scanned COI, a hiring-hall dispatch slip or a
government wage determination and it failed. Not with a sentence — with the
framework's own opaque error, before a line of ours ran. Five Server Actions
each declared `15 * 1024 * 1024` and refused anything above it, and every one
of those checks was unreachable: Next caps a Server Action body at exactly 1MB
unless `experimental.serverActions.bodySizeLimit` says otherwise, and
`next.config.mjs` does not.

    // next@15.5.23 dist/server/app-render/action-handler.js:479
    const bodySizeLimitBytes = bodySizeLimit !== defaultBodySizeLimit
      ? bytes.parse(bodySizeLimit) : 1024 * 1024 // 1 MB

The part that makes it total rather than occasional: **the cap covers multipart
file bodies too.** The size-counting `Transform` is piped INTO busboy
(`:614-640`) rather than placed after it, so a file part is counted like any
other byte. A scanned contract is the normal case, not the edge case, so these
five features worked for a token PDF and for nothing a GC actually sends.
Issue #27.

**The fix was already in this repo and is generalised rather than reinvented.**
Site capture (#195) had the same problem and solved it: the browser uploads
straight to Vercel Blob under a one-shot token minted by a route that makes
every access decision, and a Server Action records the URL afterwards — a few
hundred bytes. `/api/documents/upload` is that route for documents, and the
five actions now record a URL instead of carrying bytes.

**The alternative was considered and rejected on purpose.** #27 itself suggests
raising `bodySizeLimit` to 15MB, which is one line and would make all five
guards reachable today. It also buffers every uploaded file in server memory on
the way through, and the better path was already built and proved next door.
Only one of the two was taken — not both.

**THE PATHNAME IS THE SECURITY, NOT THE FILING.** One Vercel Blob store serves
every tenant, so a URL from it proves the file is in our store and nothing
whatsoever about whose file it is. The prefix is therefore enforced twice: when
the token is minted, after the job has been proved to belong to the caller's
company, and again when the row is recorded — because a Server Action is an
endpoint anyone with a session can post to directly, and the URL recorded is
the one `deleteDocument` later hands to `del()`. Both checks run through ONE
function (`documentUrlProblem`), which also requires the store to be OURS,
because running only the path half is exactly the bug `recordJobMedia` shipped
with: the path is the part an attacker with their own store gets to choose.

**The company-scoped one needed its own argument and got one.** Four of the
five are owned by a job, so the id in the path is re-read from the database and
checked against the caller's company. A compliance document is owned by the
COMPANY, so there is nothing to look up — and the answer is that the id is
never taken from the request at all. The prefix is built from the session, so a
caller naming another company gets a pathname mismatch rather than a check that
happens to pass. Proved by a case that dresses the lie both ways, payload and
pathname together, and is still refused.

**The token is keyed on the PURPOSE, not the folder**, and that is not
bureaucracy: `contracts/<jobId>/` is shared by two actions that do not share a
guard. `recordExecutedSubcontract` asserts MANAGE_JOBS; `uploadContractDocument`
asserts nothing beyond company membership. A folder-keyed route would have to
pick one, and either choice is wrong — the loose one mints a token the
executed-subcontract action would refuse, the strict one refuses somebody the
contract-document action admits and leaves them with a form that cannot work.
Every purpose carries the capability of the action it feeds, mirrored and never
invented; where that action is recorded as open in
`action-capability-guards.test.ts`, so is the token, because a token stricter
than its action does not close that debt, it just moves the failure somewhere
harder to diagnose.

**Two actions now return a result instead of throwing.** `uploadDispatchSlip`
and `uploadContractDocument` were server-rendered `<form action={…}>`; they had
to become client components to upload before submitting, and a client component
rendering a thrown Server Action message renders a production digest.
`uploadComplianceDocument` joined them for a sharper reason: "storage would not
give the file back" is a new and real outcome, and a person can do something
about it only if they are told.

**`uploadComplianceDocument` is the one that reads the bytes back**, because
Claude has to see the document. It fetches the URL it has already proved is our
store's and under the caller's own folder, takes the media type from the
STORE'S response header rather than from anything the caller said — the old
code trusted `file.type`, i.e. the browser — and re-checks the length before
base64'ing it.

**`putDocument` is deleted, not left behind.** Its last caller went with this
change, and a function nothing calls is the shape CLAUDE.md names. What it
argued survives: `addRandomSuffix` defaults to FALSE in `@vercel/blob@2.8.0`,
and these blobs are public, so an unguessable URL is the only thing between a
certified payroll report and anyone on the internet. That option is now set in
the token route, once, where no caller can omit it. `lib/blob-urls.ts` is a
second move of the same kind — `isBlobStorageUrl`, `blobStoreId` and
`isOurBlobStoreUrl` were never about photographs and now live where both
features can import them instead of one copying them.

**The specific checks.** 31 unit cases on the pure rules, 17 on the token route
and 21 against a real Postgres 16. The route cases do not read an object a fake
collected: `handleUpload` is the real one, signing locally, and each case
DECODES the client token and asserts the terms the store will be shown — the
pathname, one content type, the 15MB ceiling, the random suffix. Nineteen
deliberate mutations, each reverted and confirmed byte-identical by
`sha256sum`: the route's pathname check deleted (5 red), its capability check
deleted, its content-type check, its company comparison, `addRandomSuffix`
flipped, the ceiling raised to 200MB, the client's company id trusted for a
compliance token, each half of `documentUrlProblem` dropped separately, the
prefix's trailing slash, the one-segment rule, the percent-encoded-separator
rule, the URL check removed from each of the five actions in turn, and the
compliance read-back's type and status checks. Every one went red naming the
right case.

**ONE MUTATION WAS CAUGHT BY THE WRONG TEST, and it is worth writing down.**
Removing the trailing slash from the prefix — the thing that stops job `abc`
matching a blob under `abc123/` — failed nine cases but NOT the case written
for it, because the one-segment rule catches that pathname too. The pair is
genuinely load-bearing rather than one rule with a spare: with both removed,
the sibling-prefix case fails and a different company's job matches. Recorded
because "the mutation was caught" and "the test that names it works" are not
the same statement, and this file has a standing habit of conflating them.

Not verified from here, and said rather than implied: no real file has been
through the new path. The agent container cannot reach a preview or production,
and the token route's own refusals never reach a browser anyway — the SDK
discards the body of a non-2xx response (`dist/client.js:398-400`), which is
why `documentUploadErrorMessage` says the reason was not passed on instead of
inventing one. The click-list starts with a 5MB PDF, which is the exact case
that was broken.

No migration, no schema change, no new dependency.
