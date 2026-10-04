### What actually changed, in plain English (Cyrus)
`cyrus/sales-signals`

Signals had to be typed in one at a time. Now a public document can fill them
in: paste the subcontractor list off a bid or award packet, see exactly what was
read and what was not, and import the subs who are in our trades as leads with
sourced signals waiting to be checked.

**One row of one listing can carry four of the five things the band looks at** —
the portion of work is the trade, the city is the geography, the project is the
project, and the prime named at the top is the GC. So one pasted page can take a
company nobody here had heard of to a briefed, call-ready lead whose opening
line quotes a document the man himself filed. That is the whole acquisition
motion in one screen.

### The handoff this was built from was wrong about the document, and finding that out was worth more than the code

The brief said "public bid tabs name subs with dollar values." Three things in
that sentence, and the first two are false:

- **A bid tabulation names PRIME bidders and their totals.** It has no
  subcontractor column. The document that names subs is the listing filed *with
  the bid* — in California under Public Contract Code §4104, in Oregon as the
  First-Tier Subcontractor Disclosure under ORS 279C.370.
- **California's §4104 has no dollar amount field at all.** Name, place of
  business, licence number, public-works registration number, portion of work —
  and no money. Oregon's form does carry a dollar value. So an amount is
  genuinely absent on most of these documents, and anything rendering one would
  be inventing the single number these buyers would be hiring us for.
- The likely source of the confusion is itself worth recording: a search for the
  California form returns a summary describing name, category of work **and
  dollar value** — which is Oregon's statute, in the same result set. Two
  statutes, two documents, one sentence.

Everything legal here is search-summary tier and wants a lawyer or a read of the
statute before it is quoted at anybody. It is written down because the parser's
shape depends on it, not because it is settled.

### The bug that would have cost a relationship rather than a reply

**The listing is filed with the bid by EVERY prime.** One school job with five
general contractors names five drywall subs: one about to get the work and four
who are not.

The first version of the claim text read *"On Lincoln Elementary Modernization,
under Swinerton Builders"*. For four subs in five that is a sentence
congratulating a man on a job he lost, and in a trade this small that does not
cost a reply, it costs the next three people he talks to. A listing is evidence
of a **bid**; only an award document is evidence of a **job**.

So the outcome is never inferred and never defaulted to the hopeful value. The
screen asks whether that prime won, defaults to *not sure*, and the claim
changes shape rather than degrading: *"Named on Swinerton Builders's bid for
Lincoln Elementary Modernization — the listing does not say whether that bid
won"*. `signals.test.ts` fails if either the dangerous phrasing or the missing
caveat comes back.

### The property the whole thing rests on: nothing can go missing quietly

Reading seven subs off a page that holds eleven produces four prospects nobody
will ever know are missing — the shape this repo keeps paying for. So the
candidate lines are counted by an expression (`looksLikeData`: does this line
carry money, a percentage, a licence or a registration number?) that **shares no
code** with the one that parses rows, and `unread` is the **set difference**.
A candidate line that produced no row cannot be anywhere except `unread`,
because that is the only place the arithmetic can put it. The review screen leads
with that reconciliation, above the subcontractors.

One hole in it, found by writing a fixture rather than by a test failing: a
wrapped table cell leaves a line with words and no money, no licence and no
percentage, so the counter does not see it either — and the row above it parses
as a complete scope reading *"Metal stud framing, drywall and"*, which would then
be quoted down a telephone. Rows now carry **concerns**: a scope ending in a
dangling conjunction says so, and an orphan line beneath a row is attributed to
it. Attributed, not appended — appending would put text the parser guessed at
into a claim.

### Three more decisions

- **The confirm sends the raw text and the server parses it again.**
  `SpreadsheetImport`'s rule, and the selection travels as line numbers, which
  is the only thing two parses of one document are guaranteed to agree about. If
  the counts disagree the import is refused rather than reconciled. The browser
  cannot invent a subcontractor because the server never sees its rows.
- **Everything lands PROPOSED, with no reviewer.** `createSalesLeadSignal` forces
  CONFIRMED because a person typing one in *is* the review; nothing here is typed
  by a person. `proposedOnlyCensus.test.ts` reads both write sites with comments
  stripped and fails the build if the importer ever mentions CONFIRMED or stamps
  a reviewer — the two paths sit in one file four hundred lines apart, and the
  difference between them is one property name.
- **No model, which is a lane decision as much as a design one.** A listing is a
  table, so a parser is the right instrument and the cheaper one; AI extraction
  is Diego's lane. It also means the invention failure
  `lib/research/bidResearch.eval.ts` measures — a confident fact about a
  similarly-named project, carrying a citation that passes every code-level guard
  — has no mechanism here at all.

### What is NOT verified, and it is the honest headline

**No real bid or award document was read while writing this.** The egress proxy
in the container answers 403 on CONNECT for every general web host, so the
agencies' own forms could not be opened. Every column order, field name and
wrapping behaviour in `subListingCases.ts` is a guess, and the fixtures say so in
their own header.

So the suite proves the parser is self-consistent and loses nothing silently. It
does not prove it reads a real form, and no number of synthetic fixtures ever
will. The next person should paste one real listing in, read what `unread` says,
and widen from that evidence. The parser is built to survive being wrong about
the format: it requires no column order, requires no header, and hands back
anything it cannot read.

### Checked by breaking it

Fourteen mutations, each red on its own assertion: unread lines dropped instead
of reported · the candidate counter matching nothing · the city winning the
portion-of-work column · dangling-scope detection disabled · orphan lines no
longer attributed · the claim asserting a job regardless of award · the
bid-did-not-necessarily-win caveat removed · an amount rendered where the form
has none · SIZE proposed from a dollar value · "works under" used before an award
· lead matching accepting a single shared word · a possible match promoted to
certain · the importer stamping CONFIRMED and a reviewer · the importer building
its own claims instead of `signalsForSub`.

Three of those were harness failures first and are worth naming, because each
read as a pass:

- the amount-invention mutation left a dangling `else if`, so `signals.test.ts`
  failed to load, its fifteen tests vanished, and vitest reported **"68
  passed"** — a green run over a suite that had lost a fifth of itself. Every
  mutation run now asserts the total number of tests that executed before its
  colour is read at all;
- **the single-shared-word mutation genuinely survived**, and that was a real gap
  rather than a harness problem. Every existing case compared two two-word names,
  where the subset check fails on its own, so the two-word floor was never
  exercised. A one-word test was added — `leadCandidatesFor("Western", …)` must
  match nothing;
- a control written to prove the census could not go blind passed while mutated,
  because splitting the literal as `("CONFI" + "RMED") as "CONFIRMED"` leaves the
  string in the type assertion. The control was fine and the sentence describing
  it was wrong, which is the more dangerous of the two; the comment now says what
  it actually guards.

### Found on the way past, and filed rather than fixed

Building a trade classifier meant asking which trade list to import, and the
answer is that there are **six** — `lib/trade-scopes.ts`, a second module
claiming the same job in `components/tradeScopeLabels.ts`, and four hand-rolled
copies inside `EstimateTemplates`, `AddCostEntryForm`, `JobEstimateHelpers` and
`contacts/[id]/page.tsx`. Four use the same identifier name as the canonical
export, which is why nobody saw it; `lib/trade-scopes.ts`'s own docstring is a
twenty-line essay on why a second copy must not exist. All six are identical
today, so nothing is broken — it is #526's defect waiting for somebody to add a
sixth trade. Issue #608, with the census that would catch it. This reader imports
the canonical module and adds no seventh copy.

### And the action is executed now, not just read

The review's fair criticism was that `importSubListing`'s behaviour — tenant
scoping, the dedupe, the PROPOSED-only promise — was all verified by reading the
code and a source census, never by running it. `subListing.dbtest.ts` runs it.
Eight cases against a real Postgres, and the four that matter are the ones a
source census structurally cannot make: every row lands `PROPOSED` with both
reviewer columns NULL **and `qualify` still returns THIN** on a lead the importer
just filled; attaching to another company's lead is refused with no partial
write; the same subcontractor on two rows of one listing becomes ONE lead; and a
multi-prime document names no prime in any claim even with *awarded* ticked.

Mutation-checked: stamping CONFIRMED + a reviewer, removing the dedupe, removing
the cross-company check, and removing the staleness guard each turn exactly one
case red.

**It found a bug on its first run, in the test rather than the code, and that is
worth recording.** Six of eight cases failed with `Not found` — because
`assertSalesAccess` reads `isProvaOperator` off the CONTEXT, and the mocked
`requireCompanyContext` did not carry it even though the company row in the
database did. The guard was working; the harness was lying to it. A thing you
only learn by running it.

**How it was run here, since the toolchain is supposed to be unusable in an agent
container.** It is usable, narrowly, and the earlier claim in this session that a
dbtest was impossible was wrong:

  - `pnpm install --frozen-lockfile --filter @prova/db` COMPLETES. The full
    install dies on `cdn.sheetjs.com` (403 through the egress proxy), but `xlsx`
    is an `apps/web` dependency, so a filtered install of the db package is
    untouched by it — and it generates the Prisma client and fetches the query
    engine;
  - Postgres 16 is already installed at `/usr/lib/postgresql/16/bin`, just not on
    `PATH`. It refuses to run as root, and the scratchpad's root-owned parents are
    not traversable by the `postgres` user, so the data directory goes somewhere
    that user owns. `prisma migrate deploy` then applies all migrations, so the
    scratch database is real and current;
  - `apps/web/node_modules/@prova/db` does not exist, and `next` is not installed.
    Both are resolved by aliases in a LOCAL vitest config — `@prova/db` to the
    package source, `next/headers` and `next/navigation` to small stubs. Nothing
    in the repo changes, and CI resolves the real modules.

The limit is worth stating as plainly as the recipe: this reaches the db suite,
not the signed-in e2e suite, which still needs a browser the egress proxy will
not let near Clerk's FAPI host.
