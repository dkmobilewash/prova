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

### A second review, and the three findings that were one mistake

The header refused to guess a prime when a document named several — with a
long comment about why guessing was unacceptable — and kept
`if (!header[key]) header[key] = value` for `project`, `agency` and `bidDate`
three lines below it. The cost is not smaller for being a different field:
`projectPhrase` feeds both the PROJECT and the GC_RELATIONSHIP claim, so a
packet covering two schools tells every subcontractor on the second one that
they were named on a bid for the first. The rule is general now, and
`HEADER_CONFLICT` is a total `Record`, so a fifth header field cannot be added
without saying what two of it would mean.

The same shape in the money fields. `amount` took the first `$` on the row and
`percentOfBid` the first `%`, so a row printing a unit price before a total —
"$1.85/SF … $450,000" — claimed the subcontract was **listed at $1.85**, and a
scope reading "Drywall, 95% recycled gypsum" claimed the sub was listed at 95%
of the bid. Both now read only from a field that is *essentially* a figure, and
a row with two such columns gets no amount and a concern saying why.

**And the same two tests were deleting the scope in the same breath**, which
neither review caught: the portion-of-work slot excluded any field matching
MONEY or PERCENT, so that recycled-gypsum scope was discarded as well as
misread. One string, two false outputs, nothing on screen either way.

So the lesson is the shape rather than the fields: **a guard written as a
special case for the instance that bit you does not cover the next one.**

### Two things the existing suite caught that no review did

`withoutMoney` was a hand-written copy of `MONEY` whose suffix alternation read
`k|m|mm|million` with no trailing `\b`. Alternation is leftmost-first, not
longest-match, so "$1.2 million" matched the `m` and left "illion" behind;
`MONEY` escapes it only by ending in `\b`, which forces a backtrack. Harmless
while the leftover was only compared against licence patterns — and the moment
`moneyOnly` asked whether anything remained after removing the money, it
silently refused a real amount. Derived from `MONEY` now. The failure mode of a
copy is not that it is wrong on the day it is written.

And `signals.ts` promises in its own header that nothing is rounded, while
`parseAmount` rounded to whole dollars: `$450,000.75` reached a claim as
`$450,001.00`. Rounded to the cent, which keeps the protection the round was
actually for (`1.2 * 1_000_000` is not guaranteed exact in binary floating
point) and changes no figure a document printed.

### The typecheck in this container was answering about nothing

Worth more than any of the above, and now in CLAUDE.md. `tsc --noEmit` run
from the repo root exits on TS5081 — there is no `tsconfig.json` there, only
`tsconfig.base.json` — so it compiles **nothing**, and an agent that filters
the output for its own files sees an empty result and reads it as clean.

Settled the only way it can be: inject a deliberate `const x: number = "s"`
and require the checker to report it. From the root, 0 lines. From `apps/web`
with `-p tsconfig.json`, `parse.ts(391,9): error TS2322`. Several "typecheck
clean" statements made earlier in this work were that empty question; the one
in the component commit survives only because it rested on an independently
measured 142-line count, which a non-compile cannot produce.

The rule that falls out: an empty filter plus a count of ZERO lines naming
your file is the vacuous case, and an empty filter plus a non-zero count is a
real pass. On this branch it is 18 lines, all TS2307/TS7006/TS7031 from the
unlinked `react`/`next`/`@prova/db` types.

### Checked by breaking it, again

Eight more mutations, each red on its own assertion, every run reporting the
test total before its colour: first-one-wins restored (10 red, two of them
pre-existing cases, so the general rule agrees with what was already expected
of it) · a repeated identical header value counted as a conflict · `moneyOnly`
and `percentOnly` loosened back to "contains a figure" · the strict scope
exclusion restored · the first dollar column taken instead of refusing
ambiguity · rounding to whole dollars · the drifted `withoutMoney` copy,
caught by the pre-existing "$1.2 million" case.

The ninth run is the harness control and the reason the total is read first:
deleting the three new describe blocks reports **green on 215 instead of
230**.

### A fourth review, seven findings, and two of them closed by deleting things

The fourth adversarial review named the common cause better than any of the
individual findings: `readRow` picked every field by predicate over the WHOLE
ROW — leftmost match wins — rather than by column. `amount` had been moved to
column discipline after taking the first `$` on a row produced a claim wrong by
five orders of magnitude, and that reasoning was never carried across. Four of
its five serious findings were that one decision.

What the asymmetry cost, and it is the worst thing found in this feature: on a
listing with a Spec Section column, `09 29 00` — the CSI number for Gypsum
Board — beat the contractor's real CSLB licence sitting in the next column, so
the claim read **"Listed with licence 092900"** to a man whose licence is
684213. A CSLB number is the single most checkable fact about a contractor in
this state. That sentence does not read as a wrong detail; it reads as not
knowing who he is.

Fixed, with the same treatment applied to the registration, the city and the
scope. Also fixed: a wrap spanning two columns, which **invented a company**
carrying a sourced claim that a named GC had listed it on a named project —
ticked by default and undeletable; a wrapped project name reaching the two
claims that name the man's job, where `looksCutOff` was exported for exactly
that purpose and applied only to the portion of work; a lone `110%` becoming a
share of the bid; and a city printed without its state code, which won the
portion-of-work slot, left `tradeScope` null, and therefore arrived
default-UNTICKED — a lost prospect wearing the appearance of a deliberate
exclusion.

That last fix closed the heading-majority defect as a side effect, via a
discriminator worth remembering: **a column heading never names one of our five
trades.** A heading says what the column IS; a cell says what the work is.

### The two negative results, which are the part worth reading

**A conjunct for `agreed` was built, measured, and deleted.** The review was
right that `accountedFor === nonBlankLines` is a tautology, and its suggested
remedy — check whether any set-aside line looks like a row — turned out to be
unreachable: six constructed attempts could not land a row-shaped line in
`ignored` at all, and deleting the branch changed no outcome across 308 tests.
So the hole is real and is NOT where the review placed it; what is still lost is
the row carrying no identifiers, which no predicate over that pile can see
because by construction there is nothing in it to look at. `parse.ts` records
this where the dead guard was, so nobody rebuilds it.

**A refusal nearly shipped that would have deleted a working capability.** The
first percentage fix refused every unlabelled percentage; two existing tests
failed it and were right to. The architecture already had the answer — every
signal lands PROPOSED and a person confirms it — so the value is claimed WITH a
concern naming what else the column could be, and only `> 100` is refused.
Both lessons are now in CLAUDE.md.

### Checked by breaking it, and the harness failed more often than the code

325 tests. Every fix mutation-tested with the test TOTAL read before the colour
— one run reported **122 passed** against a baseline of 286, because a mutation
left a dangling reference and three files failed to LOAD while vitest called it
green. And five separate mutations SURVIVED before an honest case existed for
them; in every instance the cause was the same, that something else in the
function already handled the input chosen. The distinguishing cases are listed
in CLAUDE.md.

### Clicked in a real browser, which is where the last defect was

The review screen was driven in real Chromium at 1280 and 375 — the real
component, the real parser, the real Tailwind built from this app's own config —
by bundling it and opening it over `file://`, so no Clerk, no server and no
sockets are involved. It needs neither the preview nor CI, and the recipe is in
CLAUDE.md.

It found one defect on its first run, and nothing else in this repo could have:
the row checkbox carried `className="mt-0.5"` and no size, so it rendered at the
browser default **13x13** while eight comparable components use `h-4 w-4`. The
screen suite runs in happy-dom, which does no layout and returns zeros from
`getBoundingClientRect` — so a unit test cannot see a 13-pixel control, and the
fix is `h-4 w-4 shrink-0`, verified red before and green after.

44 checks pass, including three controls that each rule out a way the run could
be about nothing: the CSS is actually applied, the page actually hydrated, and
**zero rows are asserted before any text is typed** so a pre-existing row cannot
pass every count that follows. The run also confirms from the browser what the
component's own docstring claims and nothing checked end to end: the confirm
sends the RAW pasted text plus LINE NUMBERS, and no parsed company object.

The harness was wrong before the code was — an action stub returning `data`
where the real type returns `value` threw in a way that read exactly like a
product defect. Fixing the stub resolved that check and no other, which is what
makes the attribution evidence rather than a story.

**A census was written for this and then withdrawn.** A regex over JSX reported
16 unsized checkboxes; the TypeScript AST reported 11 of the same 26 nodes,
because `onChange={(event) => …}` contains a `>` that ends `[^>]*?` before
`className`. The 11 are pre-existing and span both lanes, so they are an issue
rather than a guard needing an 11-entry exemption list.

### A real document was finally read, and it is not a table

Caltrans publishes Post-Bid Files publicly, no login — `ppmoe.dot.ca.gov/cc?id=cc_post_bids`
— per bid-opening date, per contract, **per bidder**, not only the winner. A Bid
Book from it carries the state's own `SUBCONTRACTOR LIST` form, `DES-OE-0102.2C`.
The URL recorded in the research note is dead; the host still answers 200 with an
empty Angular shell, which is the kind of 200 that means nothing. A real browser
was needed to see that at all.

**The document is a FORM, not a column table**, and every fixture in this PR is a
column table. Sixty numbered blocks, labels printed beside the values, the licence
as bare digits with no class prefix, the registration label wrapping mid-phrase,
percentages per bid item, and the form printing its own `Sample Data Entry` block.

Measured against it, `readRow` returned **228 rows for three subcontractors**, none
clean. On a paste of only the filled blocks it reported **`agreed: true`** with
fifteen rows and no real company — the silent wrong answer this parser's whole
partition design exists to prevent, surviving 325 tests because every fixture was
a guess. `subListingCases.ts`'s own header predicted exactly this: the cases prove
self-consistency and "do NOT prove it reads a real document, and no number of them
ever will."

**So the form shape is now recognised and refused rather than mis-read.** Every
non-blank line goes to `ignored` under one named reason so the partition still
holds, a problem names the form in plain words, and no row is invented — because
228 junk rows would import 228 junk leads, and every lead this importer writes is
currently undeletable.

**What this change deliberately is NOT.** The comment above `accountedFor` already
predicted this loss — "the row carrying NONE of them… eaten by the heading-majority
branch" — and says the fix belongs in `splitFields`/`furnitureReason`, not in a
guard over the set-aside pile, which was built, measured dead across 308 tests and
deleted with a note telling the next person not to rebuild it. That note was right
and saved an hour. Reading this shape needs a block reader keyed on the numbered
toggle: a new top-level path, named as follow-up, not attempted here.

It also explains an inconsistency the diagnosis left open: `KRC SAFETY CO INC` and
`MIDSTATE BARRIER INC` became rows while a third company vanished, because
`hasDataEvidence` rescues a line carrying an entity marker and the third company
has no `Inc` — and the form writes `State CA` rather than `GOSHEN, CA`, so the
comma-state pattern misses too.

The refusal is keyed on the numbered toggle and the form's revision id, **not on
the field labels**, because a legitimate table may head its columns "Business Name
/ Location City / State". There is a control test for precisely that, and the
mutation keying it on labels turns the control red. Mutation-tested both ways: the
detector disabled reds three refusal assertions (228 rows return), the labels
variant reds the control. 330 tests, up from 325.

One harness failure on the way, caught by its own landing check: a `sed` mutation
whose pattern contained `|` never applied, and that arm reported a clean 330. A
mutation run that does not assert the mutation LANDED is a vacuous green.

### The refusal, now validated against 26 documents instead of one

The form detector was built against a single Bid Book, which is how the fixtures
it replaces came to be wrong. It has since been checked against **12 contracts
across 7 bid-opening dates and two form revisions** — `DES-OE-0102.2C(REV
04/2025)` and `(REV. 3/2015)`, whose field labels are identical eleven years
apart. Every document opens its blocks with `N) List this subcontractor?`, and
every one prints exactly 60 blocks with the filled ones first.

Keying on `DES-OE-0102` rather than a generic `REV` marker turned out to matter
for a reason not anticipated: Bid Books contain other forms carrying their own
revision markers (01/2017, 12/2024, 01/2025, 01/2024), so a loose pattern would
have matched them.

`subListingCases.ts`'s header is corrected rather than extended, because two of
its claims had expired. It said no real document had ever been read — false since
2026-10-04 — and that the proxy answers 403 for every general web host, which is
why none could be opened. Also false now: `cslb.ca.gov`, `ppmoe.dot.ca.gov` and
`data.oregon.gov` all answer 200 from an agent container. Some hosts are still
denied; the blanket claim is what expired. A measurement honest on the day, cited
later as a property of the world — inside the file warning about that shape.

The header now records what the corpus says the field reality is, none of which
the fixtures exercise and all of which a form reader must handle: licences are
bare 5-to-7 digits with significant leading zeros, or `na`, or blank, and never
carry a class prefix (the parser wants 6-to-8 digits); DIR registrations start
`10` **or** `20`, run 10 or 11 digits, and are sometimes truncated or blank (the
parser's pattern admits one of those four); percentages are per bid item and the
2015 revision writes a bare `100` where 2025 writes `50.00%`; there is no dollar
column at all, which is §4104 working as documented; and the same business
occupies several blocks while one licence appeared under two business names, so
de-duplication keys on licence, never on name.

**Two constraints that bound the feature regardless of parser quality.** Ten of
fifteen current Bid Books have **no text layer** — image-only scans returning
about one byte per page, which a person cannot copy out of either, so paste-based
import cannot reach them whatever is built. And the YES/NO state is a radio
graphic: both words appear in the text either way, so the usable rule is that a
block counts when its `Business Name` is non-empty.

**A fixture-hygiene error of mine, disclosed rather than quietly fixed.** The
previous commit's docstring invented the company name but kept the real city and
real licence number from the document, and this header first did the same with a
real licence and DIR registration. A licence number identifies that firm as
surely as its name does, so it falls under the same rule. All four are replaced
with invented values preserving the property each illustrated. Two were already
pushed; they are a city and a licence number from a document the state publishes
for anyone to read, so this is fixture hygiene rather than a disclosure, and it is
fixed forward rather than by rewriting pushed history.

**Still unverified, and unchanged as the honest headline: no real bid or award
document has been read.** Every fixture is a guess about a form nobody here has
opened, the suite is deliberately green over the remaining documented
limitations, and this must not merge on the strength of a green check.
