### Three claims in CLAUDE.md that the code stopped agreeing with (Diego)
`claude/prova-company-cam-feature-6170v6`

**Docs-only, and an audit under working agreement 1's exception.** No
behaviour change. Three statements that were false against `main` at
`c5da778`, each corrected with the evidence rather than softened.

**Invoice numbers, and this is the one worth reading.** The file said in
capitals that invoice numbers are NOT among the counters — "there is no
`InvoiceCounter` anywhere in the repo" — quoted the `max(n)+1` body of
`nextInvoiceNumber`, and ended "NOT FIXED HERE ... it goes to him as an
issue". #224 landed the counter. Read from the code first: `InvoiceCounter`
is `billing.prisma:167` with migration `20260909180000_add_invoice_counter`;
`nextInvoiceNumber` and its `findFirst`/`orderBy` are gone; and
`issueInvoiceNumber` takes a `Prisma.TransactionClient` rather than reaching
for `prisma`, upserting with `increment` inside `prisma.$transaction` at
both call sites. Seven counters becomes eight.

That paragraph has now been wrong in BOTH directions — it claimed a counter
that did not exist until 2 Sep, then denied one that did from 9 Sep — so it
is rewritten rather than deleted. **It predicted its own failure and still
failed:** it closes by explaining that the cost of a wrong sentence is the
search it prevents, and the Neon entry below it states the general form, a
note saying nobody has fixed X is a claim with an expiry date. Both were
already on `main`. Neither caught this. What caught it was a session
resetting a branch and happening to read the commit subjects going past,
which is luck, not a process — so the rewrite says so and names the cheap
habit that would have worked: grep for the symbol a paragraph claims does
not exist before trusting the paragraph.

**The egress-proxy line.** The concurrent-writes entry rules previews out as
the source of the stray `ep-little-sea` rows and reasons that a preview URL,
being a different host from `app.cstream.ai`, "would pass the egress proxies
that 403 both agents' containers". Measured twice from a container: the
preview host is denied identically — `connect_rejected`, "gateway answered
403 to CONNECT (policy denial)". The entry's CONCLUSION is untouched; it
rests on build logs and those stand. Only the reasoning was wrong, and it is
the kind of aside a later reader reasons FROM.

**New: a preview cannot be clicked with a production session**, because
previews run the DEVELOPMENT Clerk instance ("Development mode" under the
sign-in box is the tell). Established while clicking #214, where it cost a
round. The expensive half is what happens after you sign in:
`requireCompanyContext` adopts a row by verified email only if one exists in
the database it is talking to, and a preview talks to the DEMO project — so
an address with no row there silently gets a brand new empty company, and
every list page shows an empty state that reads exactly like the feature you
came to click is broken.

One verification note worth keeping: `typecheck` first came back RED on this
docs-only diff, `Property 'invoiceCounter' does not exist on type
'PrismaClient'`. That is a stale generated client on the checkout, not a
defect — `prisma generate` cleared it. Same trap the union-audit entry
records about `migrate deploy` not regenerating, arriving from the other
direction: a `git checkout` across a merge that added a model.
