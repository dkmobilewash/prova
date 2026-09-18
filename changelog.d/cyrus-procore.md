### Procore: the GC's drawings, RFIs and submittals on the sub's job, read-only (Diego)
`cyrus/procore`

The Procore card was "Coming soon". Now the owner connects Procore with their
own login (OAuth, state + PKCE, and the session decides the company — the
#136 §2 rule). They link a GC's Procore project to one of their jobs. That
project's current drawings, RFIs and submittals then show on /drawings, /rfis
and /submittals, in a separate "From the GC's Procore" section. Each one is
marked as the GC's and links back to Procore.

**They are never mixed into the sub's own RFIs and submittals.** Those are
evidence records, counter-numbered and identity-locked. A GC's "RFI 14" is
their number, not ours. So the GC's records live in their own cache
(`ProcoreItem`, additive migration `20260918220000_add_procore_feed`). That
cache is replaced wholesale on every refresh, and the Rfi/Submittal tables
never see it. The action test asserts both tables stay empty after a link.

**Read-only is a structure, not a promise.** The only function that calls
Procore's API is `procoreGet`, and its method is the literal `"GET"`. One
test runs every reader and counts the requests: six expected, six seen, all
GET, all with `Procore-Company-Id`. Another fails if a method literal other
than the token POST and that GET appears in the client.

**Refresh tokens are single-use**, per Procore's docs. So the token refresh is
the same compare-and-swap as Jobber's, and both ways of losing the race are
tested at an exact moment through a hook in the fake server.

**What Procore's docs say that the product has to live with.** A company's
data can only be read through an app that company has INSTALLED. So each GC
has to add C Stream in Procore (Company Admin → App Management) before a
sub's login can read their project through it. The Link picker lists such a
company with that sentence, instead of leaving it out silently. Production
access also needs Procore Marketplace Partner verification.

Checks: `lib/procore-client.test.ts`, `lib/actions/procore.test.ts`,
`app/api/procore/callback/route.test.ts`, `lib/procore/setup.test.ts`. There
were 17 mutations, one per guard (state, identity, company header, GET-only,
the path guard, CAS, the invalid_grant recovery, reauth marking, three tenant
scopes, owner-only, the Procore-side project check, the 429 retry,
pagination stops, the missing-config card, and keep-cache-on-failed-kind).
17 were requested and 17 returned, and all 17 were killed.
