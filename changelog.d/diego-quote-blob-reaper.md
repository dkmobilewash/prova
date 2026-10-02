### A quote read left its PDF at a public URL forever, and so did three quarters of a compliance upload (Diego)
`diego/quote-blob-reaper`

Issue #559, plus a second instance of the same defect that asking "is there
another one" turned up.

**The reported half.** `readBidQuoteDocument` took the blob URL as an argument
and no bid model has a `fileUrl` column, so every quote read left a PDF in the
store that nothing pointed at. Blobs are uploaded `access: "public"` — the URL
is unguessable, but anybody who ever holds it can fetch a competitor's pricing
forever with no sign-in, which is why documents normally reach a browser through
an authenticated route instead. A stranded one had no row in the database that
would let anybody find it again to remove it. `deleteDocument` had four callers
in the repo and none was this path.

**A `finally`, not a delete at each return.** There are five ways out of that
action — the switch being off, the store not serving the bytes back, the
allowance refusing, the extractor throwing, and success — and every one stranded
the file. Five call sites would be five chances to forget, and a sixth exit added
later would strand it again with nothing to say so.

**Nothing is lost that existed.** The browser uploads straight to the store,
calls the action once, hands the suggestion to its parent and never touches the
URL again (`QuoteReader`'s `onRead` remounts the component), and no model has a
column for it. The person still has their own file. If the quote PDF should later
be kept as evidence beside its `BidQuote` row, that is an additive change — a
column, a write, and the `finally` comes out — not a reason to leave an orphan
meanwhile. #559 named that trade-off and this is the side of it that strands
nothing.

**AND THE SECOND INSTANCE, WHICH IS THE PART WORTH READING.** `#559` is about the
quote path. Asking whether another path had the same defect found
`uploadComplianceDocument`. It DOES record `fileUrl` on the row, so it looked
collectable — and on the success path it is. But since #277 the browser uploads
BEFORE the action runs, so on all four failure paths the file already exists and
no row is ever written to point at it: the switch being off, the store not
serving the bytes, the allowance refusing, the extractor throwing.

These are COIs, lien waivers and certified payroll — a subcontractor's and their
workers' records — at a permanent unauthenticated address. Worse than a quote,
and it would have survived a fix that closed the issue as filed. CLAUDE.md
records the shape twice: *a guard that a list is complete cannot notice a second
list*, and *nothing is ever missing from a list nobody imports*.

**The two fixes are deliberately NOT the same shape, and the test is what keeps
them apart.** The quote path deletes on every exit, because the file has no
purpose once its bytes are read. Compliance KEEPS the file on success — the row
renders a link to it — so the rule there is "delete unless a row now points at
it", with a `filed` flag set immediately after the create and nowhere else. A
blanket `finally` copied over from the quote fix passes every failure case and
silently deletes the file off every document a contractor successfully filed,
which is a worse bug than the one being fixed. `complianceUploadBlob.test.ts`
asserts the success case KEEPS the file, and that mutation reds exactly that one
assertion.

**Neither deletes before the URL is proved ours**, and both tests assert it in
that direction too. `documentUrlProblem` has to accept the URL first — our own
store, this company's own folder, that purpose — because before it does, the URL
is a claim the browser made and could name an addendum's stored file, a contract
document or another tenant's upload. #195's rule that a blob URL is not proof of
whose file it is cuts both ways, and deleting by an unvalidated URL is the
dangerous half.

**Mutation-proven, four ways:**

| mutation | result |
| --- | --- |
| quote path deletes only on success | RED on all four failure cases |
| quote path deletes before `documentUrlProblem` | RED, including "an unvalidated URL must never be deleted" |
| compliance uses a blanket `finally` | RED on "a filed document keeps its file" — the copied-fix mistake |
| compliance deletes before validation | covered by the same unvalidated-URL case |

**THE "NO THIRD ONE" CLAIM THIS ENTRY ORIGINALLY MADE WAS FALSE, AND THE WAY IT
WAS FALSE IS THE MOST USEFUL THING HERE.** It said every other path taking a blob
URL had been checked — four actions take a `fileUrl`, and `labor.ts` and the rest
of `compliance.ts` persist it on the row they create. All of that is true, and it
is the wrong question.

The defect is "a blob with no row pointing at it". Taking a URL *in* is one way
to cause it. **Dropping the row while leaving the blob is the other**, and asking
that question finds three more sites:

| row delete | deletes the blob? |
| --- | --- |
| `bidAddendum` (`estimating.ts`) | yes |
| `contractDocument` (`billing.ts`) | yes |
| `complianceDocument` (`compliance.ts`) | **no — fixed here** |
| `takeoffPlan` (`takeoff.ts`) | **no — fixed here** |
| `drawingRevision` (`drawings.ts`) | **no — fixed here** |

So two of the five already did it right, which is why the pattern looked
established. `TakeoffPlan.fileUrl` is a required column, so deleting a plan set
strands an entire plan PDF.

This is CLAUDE.md's census lesson arriving at my own claim: I asserted a set was
complete after enumerating it along one axis, and the counter-examples were on a
second axis I had not asked about. *Nothing is ever missing from a question
nobody is asking.* The narrow claim is replaced rather than deleted, because the
shape of the mistake is worth more than the sentence.

**NOT FIXED, and it cannot be from here:** the blobs already stranded by past
quote reads and failed compliance uploads. Nothing in the database names them,
so there is nothing to enumerate them from — they need a sweep of the store
itself from the Vercel dashboard. A read-write blob token is a credential and
never travels through an agent channel, which CLAUDE.md states and this change
does not get to make an exception to. This stops new ones; it does not collect
the old ones. **Issue #587** carries that half, and also records that preview and
production SHARE one blob store (`BLOB_STORE_ID` and `BLOB_READ_WRITE_TOKEN` both
target production and preview with the same store id), which contradicts a
written decision and means browser testing on a preview has been writing into the
production store all along.

**ALL THREE ROW-DELETES ARE FIXED HERE TOO.** They were going to be left out —
`drawingRevision` is the other lane, which the working agreement says becomes an
issue rather than a PR. Diego took estimating, takeoff and now drawings back into
this lane on 2026-10-02, so there is no lane boundary left to respect and
splitting one defect across a PR and two issues would just be three places to
forget it.

Each deletes the file AFTER the row, never before, which is the order
`deleteBidAddendum` and `deleteContractDocument` already used. The other way
round can leave a row pointing at a file that is gone — a dead link on a document
somebody is working from, which is strictly worse than a stranded file because it
breaks something that still looks fine. `deleteTakesTheFile.test.ts` asserts the
SEQUENCE rather than just that both happened.

**`deleteTakeoffPlan` had a comment arguing for the old behaviour, and half of it
was right.** It read: *"The blob itself is left alone: a dangling file costs
storage, and a delete that half-succeeded costs a drawing somebody was working
from."* The second half is a real hazard and is exactly why the order above
matters. The first half called a public leak a storage cost — `TakeoffPlan.fileUrl`
is a REQUIRED column, so every plan delete stranded a whole plan set, a GC's
drawings at a permanent unauthenticated address. The comment is replaced with
what changed and why rather than deleted.

Mutation-proven in one pass: removing all three deletes reds exactly the three
"deletes the row and then the file" cases and leaves the six guard cases green.

Checked: `typecheck`, `lint`, and the full unit suite, all green.
