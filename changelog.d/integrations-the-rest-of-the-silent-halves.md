### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

The rest of what the three integration audits found, excluding everything that
needs a developer account. Four fixes, all of the same family: work that was
done and could not be seen.

**CompanyCam promised a mark it could not draw.** The card says imported photos
arrive "marked as imported", and `media.prisma` says in as many words that "the
galleries derive a 'CompanyCam' mark from this being non-null." Nothing derived
anything. Every reference to `companycamPhotoId` in the repo sat inside the
module that WRITES it.

The row carried it the whole time — the gallery query uses `include`, so every
scalar comes back — and the mapping in `job-media-query.ts` dropped it before a
component could ever see it. So the fix is one derived field and one line of
render, and it lands in the slot an import necessarily leaves empty: an imported
photo has no `capturedByUserId`, so where a captured photo says who took it, an
imported one now says where it came from.

This is CLAUDE.md's recurring shape with the missing half on the READ side, and
that is why nothing caught it: the write is guarded by a unique index, a
pre-filter, a P2002 catch and a test that the same photo is never written twice.
All green, all about writing. A test that a value is stored correctly cannot
notice that nobody looks at it.

**A photo store that refused a write became a redacted crash with no record.**
`putImpl` was the one call in `importOne` outside a try/catch while every other
failure there returns "failed", so it threw past `explain()`, out of the Server
Action, into production's redaction. The operator got a digest.

The message was the lesser half. The throw happened BEFORE the summary block, so
`lastImportedAt`, `lastImportStatus`, `lastImportMessage` and the sync-log row
were never written while rows already stored in that press persisted — and
`companycam.prisma` says those three columns exist because "an import that fails
silently is indistinguishable from one nobody ran."

Not exotic, either: `BLOB_READ_WRITE_TOKEN` is not in
`COMPANYCAM_REQUIRED_ENV`, so a card reads "Connected" and offers Import photos
on an install with no store, and then every photo takes this path.

It is counted apart from `failed` rather than folded in, because the summary
would otherwise have lied about the cause: these photos WERE fetched. The
sentence now says the storage is ours and the problem is not at CompanyCam —
which is the difference between the operator checking their own setup and
ringing CompanyCam about an outage that is not happening.

**Autodesk blamed the GC for a path we chose.** A 404 on the feed said "it may
have been removed, or you were taken off the project." For `/hubs` that is fair.
For the two feed paths it is not: `acc.ts`'s own NOT VERIFIED block says
`/construction/rfis/v2/…` and `/construction/submittals/v2/…` were resolved from
reference pages and never confirmed against a live project, and Autodesk's blog
says the RFI v2 API has been superseded. Those two paths are the whole feed, so
the likeliest cause of a 404 there is us asking at the wrong address.

That is worse than an unhelpful error. It sends a subcontractor to ring the GC's
account admin about a permission problem that does not exist, spending the sub's
credibility with their customer on our bug. The message now says which it
probably is, and says so plainly.

**And the setup gap underneath all of it.** `.env.example` documented QuickBooks
and not one of the other seven. Setting any of them up meant reading
`lib/<provider>/setup.ts` to learn the variable names existed. With them unset
each card renders "Not set up" with no button — correct behaviour that looks
exactly like a broken feature, which may well be the whole of what prompted
"some of the integrations aren't done". All 23 names were verified present in
source before being written down; a wrong name here is worse than no name.

`envExampleCensus.test.ts` keeps it honest by importing each provider's
`*_REQUIRED_ENV` rather than grepping for it — a regex would be the shape this
repo distrusts, and `ACC_REQUIRED_ENV` is built from `ACC_ENV.clientId` rather
than string literals, so it would defeat one anyway. Only the required names are
pinned; the optional ones are documentation, and pinning them would make the
test about prose.

**One mutation result worth more than the fixes.** `provenanceReadCensus.test.ts`
asserts the provenance column has a reader outside the module that writes it.
Its first version passed the mutation that reproduced the original defect —
because the explanatory comment left beside the fix names `companycamPhotoId`
several times, and a raw scan counted that as a reader. A census satisfied by a
comment ABOUT the defect it guards is the #185 shape exactly, and this file
reproduced it on the first try. Comments are stripped now, and the mutation reds
both assertions.

Mutation-tested throughout, each red naming the offender: the store try/catch
removed, the store failure folded into `failed`, the derived field dropped from
the mapping, a provider's env var removed, the shared key removed, and a var
present only as a comment rather than an assignment.

**Still blocked, and not on code.** Seven of eight integrations need an account
nobody holds — DocuSign a demo account then Partner Program, Bluebeam a paid
plan then a five-day review, Procore Marketplace Partner verification, Autodesk
an APS app plus a cooperating GC's admin, CompanyCam a paid plan, myCOI a
partner agreement. Jobber is the only self-serve one.
