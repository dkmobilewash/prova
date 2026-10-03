### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

Three Opus audits traced all eight integrations end to end. The headline was not
what anyone expected: **none of them is fake.** Jobber, CompanyCam, myCOI,
Procore, Autodesk, DocuSign and Bluebeam each close their round trip in code —
real OAuth with PKCE, encrypted tokens, compare-and-swap refresh on providers
whose refresh tokens are single-use, database-level dedupe, proper disconnect.
What they have never had is one run against the real service, because every one
needs a developer account or a partner programme nobody holds.

So the defect was never "it isn't built". It was that **you cannot tell whether
it worked.** This change fixes the two worst instances of that.

**One — nine providers were writing to a log nobody could read.**
`IntegrationSyncLog` has twenty write sites across DocuSign, Bluebeam, Procore,
ACC, Jobber, CompanyCam and QuickBooks. The only thing rendering it sat inside
`{impl.kind === "builtin" && …}` on the integrations page — the Sandbox card, and
nothing else. So "Connected to DocuSign", "Sent for signature", and the FAILURE
row written when a credential dies were all stored and shown to no one. That
failure row is the single piece of evidence an owner wants when an integration
stops working.

The query never had a provider filter and has always loaded these for every
connection, so this is a move rather than new plumbing. It is CLAUDE.md's
recurring shape arriving one layer out from where that file usually finds it:
not a function nothing calls, but **a table nothing renders**.

Deliberately NOT gated on `isConnected`. The moment an owner reaches for this
list is the moment a connection has just gone `NEEDS_REAUTH` or been
disconnected; blanking the history exactly then is backwards. The status pill
says whether it is live, the log says what happened to it.

**Two — Bluebeam never recorded a failure at all.** Both write sites set
`lastSyncStatus: "SUCCESS"` unconditionally with no catch, so a push or refresh
that threw left the previous success standing: the card read "synced 2 minutes
ago · ok" about an attempt that had failed. `bluebeam.prisma` says in as many
words why those three columns exist — "an integration that fails silently is
indistinguishable from one nobody used" — and they were doing the opposite.
`lib/companycam/import.ts` already handled this correctly; Bluebeam now matches.

**And the reason it could not be tested, which is the same bug one level down.**
`linkJobToBluebeamStudio` and `pushDocumentToBluebeamSession` called the client
without forwarding `deps.fetchImpl`, while `refreshBluebeamStudioSession` did. Two
of three paths had no seam to inject a failing transport into, so they had no
round-trip test, so nobody noticed the missing catch. One line per call site.

**Three — a half-done link stranded a Studio Session at Bluebeam.** The session
is created remotely and then the row is written here; if the write lost, an empty
session sat in the owner's Bluebeam account that this app had no record of and no
way to reach. DocuSign handles the same hazard by naming the envelope id and
telling the user to void it by hand. Bluebeam logged nothing. It now names the
session and its id, because the id is the only thing that makes the orphan
findable.

**The checks.** `syncLogVisibility.test.ts` asserts the activity log opens at the
same depth as the per-kind sibling blocks — a proxy for "not nested inside one of
them" that a block enclosing it cannot satisfy — and that its condition names no
provider kind and no `isConnected`. Comments are stripped first, which is
load-bearing rather than tidy: the comment left at the render site explains the
fix and says `builtin` three times, so a raw scan could conclude the opposite of
the truth.

Its first version asserted that every `{impl.kind === …}` match shared one depth.
They do not — several are nested in the status-pill JSX at columns 12 and 14. The
control failing is what found that, and it was fixed rather than loosened: the
reference is now the outermost depth, with a minimum number of blocks required at
it before it counts as a sibling level.

`sessionFailure.test.ts` covers the branch that did not previously exist, and
carries a control on itself: it proves the injected transport is the one actually
called, because if `fetchImpl` were not forwarded — which is how push shipped —
the real `fetch` would run, the call would fail for a different reason, and every
assertion in the file would be about the wrong thing.

Mutation-tested six ways, each red naming the offender: the log re-gated on a
provider kind, the log gated on `isConnected`, the log indented one level deeper
(which is what re-nesting looks like), the FAILURE catch removed from push, and
`fetchImpl` no longer forwarded — that last one reds the harness control, as
designed.

**What this does NOT do.** It does not make any integration work. Seven of eight
still need an account: DocuSign a demo account then Partner Program, Bluebeam a
paid plan then a five-day review, Procore Marketplace Partner verification,
Autodesk an APS app plus a cooperating GC's admin, CompanyCam a paid plan, myCOI a
partner agreement with illumend that is a sales conversation. Jobber is the only
self-serve one. Those are relationships, not sprints — and the audits' most
useful finding is that the engineering was never the blocker.
