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

### The shape a building owner actually posts IS a table, and the parser mostly reads it

Caltrans builds roads — across 14 of its listings these five trades appeared in
exactly one. So the question that decides whether this feature is worth anything
was never Caltrans: it is what a BUILDING owner posts. About 15 agencies were
checked. **UCLA Capital Programs publishes every bidder's filled §4104 list as a
COLUMN TABLE with a text layer** (`contract.capnet.ucla.edu`, the
"BID SUMMARY SHEET WITH SUBCONTRACTORS" PDFs): 5 PDFs, 20 bidder lists, ~149 rows,
columns separated by runs of three or more spaces. **These trades are in them** —
"Drywall", "ACT", "Acoustical Ceilings", "Framing Drywall", "Firestopping",
"Suspension Ceiling".

Run against one real bidder's list, the parser read **all 14 rows, 12 of 14 names
correct**, and got the drywall sub exactly right — name, city aside, licence
`438612`, registration, and `tradeScope: METAL_FRAMING_DRYWALL`. That is the
feature working on a real document for the first time.

Both shapes exist in the wild: UC Davis Health posts a FORM instead (a
BuildingConnected export, different again from Caltrans'), and UCSB posts sub
names in free text with no licence. Four agencies posted a prime-only bid
tabulation, four hosts are 403 from here, and no school district or community
college produced a filled list — several sit behind PlanetBids portals nobody has
driven. Which shape is more common is NOT established; n=2 agencies with lists.

**One real fix, with two independent corpora behind it.** `REGISTRATION` was
`1\d{9}` and silently dropped `2000015618` from a UCLA row while every other
field on it read correctly and `agreed` stayed true. Both the UCLA document and
the 26-document Caltrans corpus show registrations starting `10` AND `20`. Now
`[12]\d{9}`, mutation-tested: reverting reds exactly the one new assertion. The
bound is stated in the code rather than pretended away — a bare 10-digit PHONE
column would now match, an exposure doubled rather than created, and no document
seen has a phone column because §4104 does not ask for one.

**Two defects measured and PINNED rather than fixed**, with the file's existing
TODAY convention so they go red when someone fixes them:

- **The real column ORDER is not the one any fixture assumes.** UCLA prints the
  scope FIRST and the company SECOND. Where a company carries no `Inc`/`LLC`, the
  name predicate prefers the scope cell: 2 of 14 real rows came out named
  **"Concrete"** and **"Millwork"** with the real companies demoted into
  `portionOfWork`. `agreed` read true throughout, so the importer would create
  two leads named after trades. Same root cause as the Caltrans form's lost
  company — no entity marker — and the fix is the one the comment above
  `accountedFor` already names: `splitFields` learning column positions from the
  heading row, which UCLA prints.
- **A bare city yields no geography.** UCLA writes "Valencia", not "Valencia, CA",
  so 13 of 14 rows read `city: null`. The one that worked was "Temple City", and
  only because of its name. This was already recorded as a residual; it is now
  measured on a real document rather than predicted.

335 tests across 16 files.

### The column order is learned from the heading, and the real document now reads

The parser took the first plausible field as the company name, which is only right
if the name is in column one. UCLA prints the SCOPE first. On the real document
that cost 2 of 14 names and 13 of 14 cities, with `agreed: true` over all of it.

A **column plan** is now learned from the heading row the document prints and
applied to the rows that follow. Measured on the same real bidder list:

| | before | after |
| --- | --- | --- |
| names correct | 12 of 14 | **14 of 14** |
| cities read | 1 of 14 | **14 of 14** |
| the drywall sub | correct | correct |

The two leads that would have been created as "Concrete" and "Millwork" are now
the companies that are actually on the page, and the 13 bare cities read because
a column headed `Location:` makes "Valencia" readable where no pattern can.

**Character offsets were tried first and rejected on measurement**, which is worth
recording because it is the obvious design: in the real document the heading tokens
begin at characters 37, 60, 142, 166 and 180 while the cells beneath them begin at
42-47, 86-105, 150-160 and 174-180. `pdftotext -layout` approximates a
proportional font, so a cell drifts tens of characters from its own heading. The
ORDER is what is stable, so the plan maps heading position to field index.

**It validates, because an index map is one empty cell from nonsense.** The plan
is used only when the row has exactly as many fields as the heading had columns,
and every field it assigns must still pass the test that field already had to pass.
Anything else falls back to the predicate path unchanged — which is why all 335
pre-existing tests kept passing: their headings describe the order those fixtures
already assume, so the plan agrees with the predicate and changes nothing.

**Calibrated against 20 real bidder lists, not the one document.** The corpus says
the column order never varies and no amount or percentage column exists — but the
heading LAYOUT does vary, and only two of four variants give a usable field count:
9 lists print the labels on their own line, 7 print them on the same line as "Sub
Contractor Listing" (handled by trimming unrecognised columns at either end), 3
wrap `License #:` across two lines, and 1 is compact. The last two degrade to the
predicate, and there is a test asserting that degradation with its measured cost.
Of 154 real rows, 12 have a field count that does not match, so they degrade too.

**`ACT` is why the scope column matters.** Acoustical ceiling tile, one of the five
trades, appears on nine of the 154 rows and the scope predicate requires four
letters — right for guessing at an unknown column order, wrong once the document
has named the column. Before the plan that row's scope read as its own CITY; with
the plan it reads `ACT`.

**A guard was written here, mutation-tested, found dead, and deleted rather than
given a test.** `columnPlanFrom` required the heading to name a company column, on
the argument that a plan which cannot find the company does not fix the defect.
True and irrelevant: the name already falls back by itself when no column matches.
The mutation removing the condition left all 340 tests green, and keeping it threw
away a perfectly good `Location` column because the same heading failed to label
its company. The test defending it was asserting something the guard did not cause,
and now asserts the mixed truth instead.

Mutations, each landing and each reding its own assertions: name column ignored
(2), city ignored (3), scope ignored (1), title-trimming removed (1), row/heading
length guard removed (1). 340 tests across 16 files.

**One self-inflicted bug worth recording.** The `COLUMN_KINDS` patterns were first
written through a non-raw Python string, so every `\b` became a literal backspace
byte and all five regexes matched nothing. The symptom was silent: the plan built,
returned all-nulls, and every test stayed green because the parser simply fell back
to its old behaviour. What caught it was the TODAY tests NOT going red — a fix that
changes nothing is the same shape as a fix that is not wired up.

### `ACT` was silently excluding real acoustical-ceiling prospects

Three of 154 real rows have a scope of exactly **`ACT`** — Acoustical Ceiling Tile
— and all three are genuinely acoustical firms; their company names say so. They
matched no trade, and `shouldInclude` ticks a row only when the trade matched, so
each arrived **UNTICKED and was silently left out of the import**. A lost prospect
wearing the appearance of a deliberate exclusion.

`TRADE_KEYWORDS` already carried `"act ceiling"`, so the acronym was anticipated
and assumed to be written beside the word. The documents write it bare.

**It cannot be fixed by adding `"act"` to that list, and checking why came first.**
`tradeMatchFor` lowercases the scope and asks `haystack.includes(keyword)`, so the
keyword `"act"` would also match **Contract**, **Contractor**, **Compaction**,
**Extraction** and **Practice** — filing "Contract Work" as acoustical ceilings and
ticking it for import. So acronyms get their own list, matched case-SENSITIVELY on
word boundaries against the original string. Lower-case `act` is therefore missed
deliberately: the case is what makes "Contract" safe, and the bound is recorded
rather than left as a surprise.

Measured against all 12 distinct real scope strings in the five trades: 11 already
matched, including `Suspension Ceiling`, `Firestopping`, and both multi-trade cells
(one of them via "Gypsum Board"). `ACT` was the only gap.

Mutation-tested two ways. Removing the acronym loop reds 2 tests. **"Tidying" `ACT`
into `TRADE_KEYWORDS` as a lowercase word reds 21** — which is the point of the
trap tests, since that refactor is the tempting one.

### Three leads were named after towns, because a plan can fit by count and be one slot out

`plan.length === fields.length` is the guard against a shifted column index, and it
is necessary rather than sufficient. Four of twenty real bidder lists wrap `License`
across two lines, so the heading LINE carries four labels and the plan is four wide
— and a row whose portion of work wrapped away has four fields too. It matches by
count, every slot shifts one to the left, and **the city lands in the company
slot.**

Measured on the real corpus: three leads named **"San Diego", "Corona" and
"Gardena"**. Not a null and not a concern — a wrong company name, with a real trade
and a real licence beside it making it look entirely credible, on a lead this
importer cannot delete. The column plan was built to prevent exactly this swap.

**The tell is a PAIR of slots disagreeing with their own kinds** — the company slot
reads as a place AND the place slot does not. One slot alone would be a guess: a
firm named after its own town has a place slot that reads perfectly. That control is
a test, and it is why the condition is written as a pair.

**THE FIRST VERSION REFUSED FIVE ROWS TO FIX THREE, and the correction is the useful
part.** Two of the others — and one of the three — carry a company name with an
entity marker plainly on the line, in the slot the shift moved it into. So the shift
disqualifies the PLAN, not the row: `ENTITY_MARKER` is evidence that survives a
shift because it is a property of the value rather than of its position. Refusing
those threw away an identifiable prospect to avoid a wrong one, which is the trade
this file argues against everywhere else.

Only where no field carries one is the row refused, and there the refusal is right
twice over: the remaining fallback is "the first field that could be a name", which
on these rows is the portion of work. A named gap beats a lead called "Metals", and
both beat one called "Corona".

**Fixing the name moved the wrong value rather than removing it**, which is the
second thing worth recording. One row came back correctly named with
`portionOfWork: "San Diego"` — and the portion of work is quoted verbatim in the
claim somebody reads down a telephone. So the positional scope fallback is withdrawn
on a shifted row, because position is the thing that has gone wrong. A scope that
names one of our five trades still survives, because that is intrinsic to the value.

Net on the 20 real lists: **158 rows to 157, three wrong company names gone, one
scope-as-city gone, one row honestly refused, and not one city lost.** 372 tests.

**AND ONE CHANGE WAS WRITTEN, MUTATION-TESTED, MEASURED DEAD AND DELETED.** The
diagnosis also reported that `columnKindOf` classifies a heading field collapsing two
labels — `Portion of Work: Name of Business:` — as `name` alone, since `COLUMN_KINDS`
tries `name` first, yielding a plan with no scope column. The argument is sound and
the fix was in. Then the mutation restoring the old behaviour left all 372 tests
green, and the real corpus was **byte-identical in every count** with it reverted —
the row it was supposed to explain is glued in the document itself and stays glued
either way. A fix with no measurable effect and no test that can fail is the shape
this repo deletes, so it is deleted rather than kept with a comment arguing for it.

**Still open and NOT fixed here**, so this entry cannot be read as closing it: the
wrapped-`License` heading costs **12 cities** on the real corpus, because a four-label
heading and a five-field row never produce a usable plan and no UCLA list prints a
state code for the fallback patterns to find. The control row in the new tests
asserts that loss as it is rather than as it should be.

### The labelled-column form is now READ, and says which question it is not answering

The refusal above is a floor, not a capability. UC Berkeley and UC Davis Health are
where this product's trades appear, and a refusal gets nobody a prospect.

**Two questions come out of a page with six bidders side by side, and they are not
equally answerable.** Which firms are listed, with trade, city, licence and DIR —
and which BIDDER listed each of them. Every failure mode in the corpus lives in the
second: one real document names five bidders and prints four columns, because bidder
one listed nothing, so an ordinal attribution puts every row in it against the wrong
GC. Matching the bidder header's offsets to the values' offsets is not available as
a fallback either; in one document they do not coincide.

So the reader answers the first and says, as a document-level problem, that it is
not answering the second. "One of these GCs on this project" is true and useful. A
guess at which one is a wrong thing said confidently down a telephone.

**Cross-checked against an independent prototype** written from the same documents
by a separate pass: both return 27, 27, 11, 41, 3 and 4 rows on the six fixtures.
Two implementations agreeing beats either one's own test.

Eight mutations, each landed and each reding its own assertions — and three of them
were written only after the first version of the test failed to distinguish
anything:

- **nearest column replaced by ordinal position.** The obvious test did NOT catch
  this: when every family line in a slot carries the same number of values,
  counting from the left and measuring from the left agree. It takes a slot whose
  families DISAGREE — a portion line with two trades and a name line with one firm,
  in the second column — and then ordinal files that firm under the other trade.
- **one grid for the document instead of per page.** Also not caught at first: two
  pages holding different slots are keyed separately anyway. It takes a slot SPLIT
  by the page break, which a real document does — the name on page one at offset
  133, the licence on page two at offset 83. A single grid makes those different
  columns and the licence is silently lost.
- **the slots keyed per page.** Found by that same test: slots must outlive the
  page while the grid must not, because a page-local column INDEX is comparable
  across pages and an offset is not.
- the N/A filter, the wrap distance bound, the run-together recovery, the
  two-character grid tolerance, and the bidder-attribution warning.

**A label and its value separated by ONE space defeats 2+-space splitting**, and
that cost a field silently. The recovery trims trailing words until what remains is
a label. It must accept only a WHOLE label, never a wrap fragment: `Name of
Licensee` trims to `Name of`, which is a name fragment, so the prime's own licence
block produced a subcontractor called "Licensee" and took a one-bidder document
from 3 rows to 5. A fragment cannot have a value adjacent to it on its own line by
definition — what follows the tail of a wrapped label is the rest of that label, on
the line above.

Concerns rather than refusals, on values that are all real in the corpus: a licence
that is not 6-7 digits (`C-10 1030181`, `9028`, `na`), a DIR that is not 10 digits,
a street address in the city field, and an alternates-only listing. `agreed` is
false for a structural reason stated in the code: one label line carries several
subcontractors and one subcontractor is assembled from five lines, so rows and
lines cannot be compared at all.

**Not read, and the reason is a measurement.** `Amount of Subcontract` is the only
per-sub dollar figure anywhere in the corpus and it sits on its own offset grid: in
the one document that has it, slot 1's `$6,625` starts at 96 while the two name
columns are at 49 and 104 — so nearest-column would attach bidder one's amount to
bidder two's subcontractor. A wrong dollar figure is worse than none.

**A known gap, stated rather than discovered later:** a pasted EXCERPT of a single
slot is not detected as this form at all, because the thresholds need the name and
licence families twice and one slot prints each once. It falls through to the table
reader. The thresholds cannot be lowered without risking a wrapped table heading,
which is a real shape four of twenty lists print.

368 tests across 16 files.

### The form refusal was keyed on one publisher, and a second form was inventing leads

The Caltrans refusal argues — correctly — that keying on the LABELS would refuse
legitimate column tables, so it keys on the numbered toggle and the `DES-OE-0102`
revision id instead. What nobody noticed is that those two markers belong to ONE
publisher. **UC Berkeley and UC Davis Health publish the same §4104 list as a
different form** — labels down the left, each bidder's answers in a column to the
right — and it fell straight through into the table reader.

Measured against six fixtures built from real documents:

| document | rows invented | **ticked for import** |
| --- | --- | --- |
| Berkeley, 6 bidders | 52 | **6** |
| Berkeley, 2 bidders | 63 | **4** |
| Berkeley, 4 bidders | 41 | **2** |
| Berkeley, 5 bidders | 29 | **2** |
| UC Davis Health | 36 | 0 |
| Berkeley, 1 bidder | 15 | 0 |

**The row count is the dramatic number; the ticked count is the dangerous one**,
because a row is only imported when its trade matched. Fourteen leads across four
documents, wrong in two distinct ways: a real firm under the WRONG TRADE — a
plumbing company ticked as metal framing & drywall, a casework company as lath &
plaster, where the name is right and the trade is a lie and the trade is what
somebody reads down a telephone — and the form's own instruction text as a
company, `(e.g. electrical, mechanical, concrete)`, ticked three times in one
document.

`agreed` already read false on all six. That is the honesty signals above working
and it is **not** a refusal: a person looking at 52 rows and a warning can still
press the button.

**What makes it safe to key on the labels after all is POSITION.** In a form the
label is the first thing on its line with the values to the right; in a column
table every label is on ONE line, so only the first of them leads. Matching the
LEADING FIELD refuses the form without touching the tables — UCLA's heading leads
with `Portion of Work:` and carries `Name of Business:` to its right, so it scores
the name family zero however often the words appear.

**Which threshold is actually carrying the weight, measured by keeping one clause
and dropping the other two** — because removing any single clause reds nothing:
every legitimate document fails at least two, so each is individually redundant
and a one-at-a-time run proves only that. Kept alone, `lic >= 2` separates every
document and so does `size >= 3`; **`name >= 2` alone REFUSES a table this parser
reads**, because two primes' tables pasted together print their heading twice. The
licence family is the discriminator, structurally: in a table `License #:` is
never the first field on its line, and in this form it always is.

Four tests, and the two that READ rather than refuse are the point: a table
leading with the company column, and two primes' tables pasted together. Both
would be eaten by a substring match. Also probed and clean: wrapped two-prime
headings, in both the portion-leads and name-leads variants.

**One case deliberately NOT fixed, and said rather than hidden.** A Final Bid
Results sheet carrying no subcontractor section at all still yields 11 rows —
`Base Bid`, `Estimated Cost`, `Unit`, `Basis of Award`. **Zero are ticked**, and
both of the honesty signals above fire on it by name. That is a different question
— "is this a subcontractor listing at all" rather than "is this a form" — and
guessing at it would cost a working capability for a document that already warns
twice and imports nothing.

356 tests across 16 files.

### `agreed` was lying on every damaged page, and now it says so

A diagnosis across the 20 real bidder lists carrying 154 known rows found
`reconciliation.agreed` reading **TRUE on all 20 — including the eight that lost or
mangled a row.** 125 of 154 rows were perfect, 29 were not, and nothing said which.

It is structural rather than an oversight: a wrapped cell lands in `ignored` as
"one column only" and a two-field fragment becomes a row, so the partition always
sums and `accountedFor === nonBlankLines` can never notice. `unread` was empty on
all 20.

**Three signals close it, and the measured result is 6 of 8 damaged blocks flagged
with 0 of 12 clean blocks wrongly flagged:**

- **A one-column line stranded BETWEEN two rows** is a wrapped cell, so the row
  above or below is incomplete. There is a control test asserting the same fragment
  ABOVE the rows stays quiet, which keeps this positional rather than a blanket
  complaint about one-column lines.
- **The document names a licence or DIR column and the cell does not read.** `394`,
  `88` and `PW-LR-1001079292` are all real printed values that parse as nothing;
  three of 154 rows lose an identifier that quietly with every other field fine.
  The plan is what makes it sayable — the heading named the column, so the
  disagreement is between the document and this reader.
- **A recognised heading whose columns cannot be matched to the rows** means the
  rows were read by guessing.

**NONE OF THIS IS THE GUARD THE FILE SAYS WAS DEAD**, and the distinction is the
reason it works. That guard asked whether a set-aside line LOOKED like a row — a
content predicate, and useless here, because a wrap fragment is `Services` or
`INC.` or `PW-LR-`; no predicate over its text can see it. These ask about POSITION
and about what the document's own heading promised. Neither question was available
before the column plan existed.

### Reading the heading as text, not as whitespace

Four of 20 real lists print their labels in ways that break a 2+-space split while
their rows are ordinary five-column rows: one puts the last three labels in one
field, three wrap `License` onto the line above its `#:`. The labels are now also
scanned as TEXT in order of appearance, and `readRow` takes whichever derivation
matches the row it is looking at — preferring the field-based one, which keeps a
slot for a column this parser does not recognise.

**Worth 3 cities on the real corpus: 128 to 131 of 154.** That is the honest figure
and far smaller than the 25 it looked like it would be.

**AND THE REASON GIVEN HERE FOR THAT GAP WAS WRONG, corrected before this branch
merged.** This paragraph said the four problem lists' heading lines "are not
recognised as headings in the first place", so neither the plan nor the warning
reached them. Measured instead of asserted: `furnitureReason` detects a heading on
**20 of 20** real lists, these four included. The plan and the warning do reach
them. What fails is one step later — a `License` label wrapped onto the line above
its own `#:` leaves the plan one slot short, and the rows fall back to a positional
read that has no city slot. It costs **12 cities**, it is a different fix from the
one named here, and naming the wrong one would have sent the next person to the
wrong function.

Five mutations, each landing and each reding its own assertions: the stranded-line
problem removed, its BETWEEN-rows bound removed, the planned-column concern removed
(2 red), the heading-unusable problem removed, the label scan disabled. 351 tests.

**Still unverified, and unchanged as the honest headline: no real bid or award
document has been read.** Every fixture is a guess about a form nobody here has
opened, the suite is deliberately green over the remaining documented
limitations, and this must not merge on the strength of a green check.


### Which bidder listed each subcontractor

The leads this reader produces are only worth calling because of one field, and until
now it was not read. A §4104 page is a list of subcontractors **under a prime
bidder's name** — several bidders per page on a bid-summary sheet — and the sentence
that makes a cold call warm is *"I saw <GC> listed you on <job>"*. Without the GC the
import yields a trade and a town, which the free CSLB licence file already gives.

`ListedSub` now carries `listedBy: string | null`. A bidder is recognised ABOVE the
table edge, or between tables, by three things together: it sits left of where the
table's own columns begin (`tableStartsAt`, derived from the first line whose fields
contain a recognised column label — not from `fields[0]`, which read the page title
and put the edge at column 3), it is not bid furniture (`BIDDER_FURNITURE`), and a
bid figure follows it before the next candidate. A name wrapped across two lines is
joined on the first field only, so `Williamson Construction Co., Inc.` arrives whole.

**188 of 223 rows attributed on the real corpus (84%), every GC name correct.** The
20 single-bidder blocks are unchanged at 157 rows / 131 cities / 151 scopes, so this
reads a field that was being discarded rather than altering anything already read.

**Two of six mutations SURVIVED, and they are reported rather than patched over,
because a surviving mutation here is a case that proves nothing rather than a weak
guard.** Dropping the bid-figure gate (M2) and dropping the left-of-table indent test
(M5) both leave the suite green: on every fixture in it, the OTHER two conditions
already exclude the lines those clauses exist for. Both clauses earn their place on
the real corpus — without the figure gate `UCLA Capital Programs` is attributed as a
GC — so the honest statement is that the fixtures do not yet distinguish them, not
that the clauses are unnecessary. A distinguishing case for each is the named next
step.

**Unchanged and still the headline: no real bid or award document has been read by
anybody here.** The 84% is measured against pages assembled from public records, not
against a form a customer sent.

### The wrapped `License` heading, which cost 12 cities

The entry above named this as the next gap rather than claiming it fixed, and
corrected the false reason it had been given. This is the fix. **Cities on the
real corpus: 131 → 143 of 157 rows.** Rows, names, scopes and problems are
byte-identical either side of it — a row-level diff of all 20 lists shows only
`city: null → <the correct city>` on twelve rows, plus one correctness fix the
now-complete plan gives for free: a row that read `scope="Zeffery's Cabinets"
name="Millwork"` — the exact "a lead called Millwork" defect `columnPlanFrom`
was written to prevent — is now the right way round.

Three of the twenty lists print it: the `License` label sits on one line and its
own `#:` on the next, so the heading line names four columns while the rows carry
five. The plan matched by count and the rows fell back to a positional read with
no city slot.

`headingJoinedWithWraps` joins a fragment on the physically adjacent line to the
heading column whose horizontal span it OVERLAPS, and a token overlapping nothing
becomes a column at its own offset — which is what `License` is, sitting in the
gap between `Location:` and `DIR #:`. **It is not keyed on the word "License".**
Every position comes off the page, so this reads the document rather than
inventing the order that `planByLabels` rightly refuses to invent; the same wrap
on `DIR Reg. No` or `Name of Business` is handled by the same code.

Four conditions keep a DATA row out of the heading, and the measurement that
matters is that **all four initially survived mutation** against the corpus and
the capability fixtures. Rather than strengthen anything, each was asked what
else already handles the input — and each turned out to be confined by a
*different* neighbour, so each needed its own narrow case: a line as wide as the
heading with `pending` where the identifiers go (only width gives it away); a
narrower row whose company is literally "Pacific License Co"; the same with no
identifier at all, caught only by its first cell naming one of our five trades;
and a `Notes` fragment that names no column, which widens the plan with a phantom
and makes a double-spaced scope cell read as the company name.

The first version REPLACED the other plans and was rejected on measurement: +4
cities, but it lost a correct one, turned an honestly-UNREAD line into a lead
named "Metals", and wrote a city into a portion of work. The joined plan is a
third candidate instead, and of those matching the row's width the one naming the
most of its own columns wins.

`splitFields` is now `fieldSpans(line).map(s => s.text)` — one definition of a
column boundary rather than two, the `MONEY`/`moneyOnly` scar.

**Also corrected in `parseShapes.test.ts`, and both were pointing readers away
from the real defect:** an assertion that deliberately recorded the UNFIXED state
(expecting `city` to be null, citing "12 cities on the real corpus"), and the
claim that these headings "are not recognised as headings in the first place" —
false, and false when written. And the fixtures for that block were never the
shape they described: `License` sat *over* `Location:` and `#:` sat at the left
margin. Realigned into the licence column's own gap.

The `154` denominator used in several places was stale; the harness counts **157**.

13 mutations, 10 killed. **Three survive and are reported rather than papered
over**: dropping a column sort, an untrimmed span offset, and taking the first
overlapping column instead of the largest-overlap one. All three need a fragment
token spanning two heading columns or a one-character offset — inputs neither the
corpus nor any non-absurd construction produces, since `fieldSpans` separates
columns by at least two spaces and real fragments are short. They are kept
because each is arithmetic that makes the span correct by construction rather
than a condition, so removing them would be wrong-by-construction for that input
rather than merely untested.

**14 of 157 rows still read `city: null`** and the causes are now named rather
than mysterious: `best-contracting` (0 of 4) wraps its CITY cells onto their own
lines, so no row has five fields and the join has nothing to apply to; `caltec`
(2 of 4) single-spaces `Monrovia 791060` into one field, so rows need the
compact-reading treatment headings already have; and four rows across `suffolk`
and `fasone` lost a cell to a wrap entirely, which would need knowing WHICH cell
is absent — the invention this file refuses. One `fasone` line stays honestly
UNREAD with its reason, which is the correct outcome and was preserved.

One capability deliberately NOT shipped: joining the FIRST DATA ROW into the
heading would infer an unlabelled column's meaning from its contents and read
those cities correctly on two constructed fixtures. Left out because it makes row
one's content define the plan for every row, on a third fixture it silenced a
true page-level warning, and it is unmeasured on real data.

### The column knew which GC, and the sentence named the wrong one

The whole cold-outbound channel rests on one sentence — *"I saw <GC> listed you on
<job>"* — and the previous commits taught the READER to attribute each row to the
prime bidder it sat under, then stored it as `SalesLead.listedByGc`. The claim a
person reads down the telephone was still built from `header.prime` alone.

**The defect was real in both directions, and the second is worse.** Measured on
synthetic multi-bidder inputs before anything changed:

- **No `Prime:` label, two bidders each with their own table.** `header.prime` is
  null, so every `PROJECT` claim named no GC at all and **`GC_RELATIONSHIP` was
  dropped entirely** — one of the two kinds that lifts a lead to *Call this one*,
  absent on exactly the documents per-row attribution was built for.
- **One `Prime:` label at the top, a later bidder's own table below.** The claim
  named the FIRST prime, by name, for a row listed by the second — and
  `parsed.problems` was **empty**, because `readHeader` saw a single prime and had
  no conflict to report. Specific and wrong, silently, on a sentence meant to be
  read aloud.

**Why 388 tests never saw it: every row of all 16 `SUB_LISTING_CASES` fixtures has
`listedBy === null`.** The shared corpus exercises no per-row attribution anywhere,
which is recorded here because it is still true — closing that gap belongs with
whoever owns `subListingCases.ts`.

`listedByGcFor(sub, header)` is `blank(sub.listedBy) ?? blank(header.prime)`, read
out of `lib/actions/sales.ts` rather than invented, and exported so that file can
call it instead of keeping the second copy #526 warns about. Until it does, a
cross-file census reads the write site out of `sales.ts`'s source and fails if the
precedence drifts — tolerant of renames, with a vacuity guard on the match count,
and its failure message names the one-line fix.

`gcPhrase` also marks a GC name that visibly does not finish, the treatment
`projectPhrase` already gave a wrapped project: "I saw Hutchinson Brothers and
listed you" is a sentence somebody says out loud.

`PROJECT` gained an unknown-GC doubt clause — claim it and say what is doubtful,
per the architecture. **`GC_RELATIONSHIP` still returns null when no GC resolves**,
and that is deliberate: a confirmed relationship naming nobody would move the band
to *Call this one* on nothing anybody can ring. The labelled-columns refusal to
guess which of several bidders listed a sub survives untouched.

388 → 404 tests. 13 mutations, 13 red. **One survived first and is the honest
find:** removing the `if (!prime)` guard, so a `PROJECT` claim appends "the paste
does not say which prime bidder listed them" even when it has just named one, left
all 403 green. Nothing else was doing that work — every existing assertion checked
what a claim SAYS, none checked that it does not then take it back, and the hedge
is the half a listener believes. Closed with a test that reds on that mutation
alone, verified independently.

Two harness mistakes caught by their own controls rather than by inspection: the
cross-file census first matched the TYPE DECLARATION of `listedByGc`, 500 lines
above the write, and reported the rule broken while it was intact (that is now its
own mutation); and the first probe asserted nothing about its premises, which is
how the all-null fixture gap was found.

**Flagged, not fixed:** `parse.ts` raises a problem for a cut-off `header.prime`
but raises nothing for a cut-off row `listedBy`, so `Hutchinson Brothers and`
reaches the stored column with no concern. The claim marks it; the column and the
screen do not.

### A third form, and the source somebody was about to automate produced 412 fabricated leads

An overnight survey named **San Francisco Public Works** the first §4104 source worth
automating: sequential ids at both levels so the back catalogue walks, honest status
codes, text-layer PDFs, and the only source measured anywhere carrying an **email, a
phone number and the subcontract amount**. It called SF's numbered-box form "already
supported", and the obvious worry was that it would instead trip the Caltrans
`numbered-blocks` refusal and yield nothing.

**Measured on the real 60-page document: not zero. 412 rows for 7 subcontractors, none
of them a subcontractor.** Commonest names `"Lower Tier;"`, `"12. IF LBE, CHECK"`,
`"Proposed Subcontractors Form"` — a 59× inflation of pure fabrication, in front of
nothing but a warning, into an importer whose every lead is undeletable.

**Why both detectors missed, which is the transferable part.** Caltrans keys on `1)`
and the `DES-OE-0102` revision id; SF writes `1.` and carries no revision id. And every
SF label is prefixed with its own box number (`2. SUBCONTRACTOR NAME`), so none of them
*leads* a `BC_FAMILIES` line either. `formShapedListing` returned null and the document
fell straight through into `readRow`. Two refusals, each correct about its own
publisher, and a third publisher between them.

So `"numbered-boxes"` is detected and READ. On the real file: **7 rows, every field
correct by hand-check, partition whole** (2,088 accounted for = 2,088 non-blank lines),
160 blank templates skipped and reported — 7 + 160 = 167, reconciling with an
independent block-marker count.

Detection keys on the box NUMBER in front of a line-leading label, never on label
words, and the scope was measured rather than assumed: over **64 documents** (the 20
real lists, every `subListingCases.ts` fixture, every multi-line template literal in
both test files) exactly one scores a single numbered-box family, and it scores all
twelve, 167 times each.

**The clause that matters most assigns every value by COLUMN SPAN**, `[label.start,
nextLabel.start)`. One real block has box 8 empty and box 9 filled, so the only value
under `8. LICENSE NO.` is the SF business tax registration — and a nearest-value reader
claims it as a contractor licence, which joins the lead to **somebody else's CSLB
record**. Verified independently by mutating the span assignment to nearest-label: 7
tests red, total still 424.

A block is recognised by a FILLED box 2, never by a label, because 43 of 60 real pages
are the blank template — the trap the survey measured as 167 names where 7 exist.
`EMAIL`/`PHONE NO.` carry no box number, so they count as column boundaries only on a
line that already has one; without that the email is read as part of the company name.
Blocks close on the next box 1, so `sourceText` quotes only the row's own block. **The
Caltrans refusal is untouched and tested first.**

**The amount objection does not apply here, established by measurement rather than
argument.** `readLabelledColumnsForm` refuses the amount because there the figures sit
on a grid shared by up to six bidders. Here box 10 is inside the same block, bounded by
the next block's box 1. A fixture of five adjacent blocks asserts both that each figure
lands on its own row and that the three EMPTY boxes read null rather than inheriting a
neighbour's — the second being the only direction that can fail.

**AND THE FIELD SF DOES NOT CARRY MATTERS MORE THAN ANY IT DOES: there is no prime.**
The firm-name line is a signature block, empty in the text layer of all three bidders'
submittals. `listedBy` is null on every row and a problem says so. The survey called the
GC relationship the whole pitch — so anyone building a fetcher on SF needs to know it
supplies the contact details and not the sentence.

157 rows / 143 cities / 151 scopes / 20 of 20 headings on the real corpus, byte-identical
to before — teaching a third form changed nothing about the twenty lists already read.
388 → 424 tests.

15 mutations, 11 killed. **Four survive and are documented in the code at the point
somebody would delete them**, each because something else already handles the input:
a 4-family document with no name box can only produce "not one filled block was found";
no address in the corpus has two city-state-postcode runs, so first-vs-last match is the
same string and the digit-excluding class is what rejects `Suite 800`; every value in
every document read sits to the right of its own label, so the ±2 tolerance is
unexercised and says so; and the two shapes are disjoint (`1)` vs `1.`), so detector
order cannot matter. One kill was also killed for the WRONG reason — dropping `MONEY`'s
`$` requirement reds the amount test only because `parseAmount` independently requires
the symbol — and the comment was corrected rather than the code, so the next person
simplifies the right function.

**Every identifier in the fixtures is invented and that was checked twice, because the
first draft leaked.** Real licences, DIRs, addresses and two contract figures were
copied in from the document's geometry, and more were found in the agent's own comments
where it had quoted the packet. Verified independently here: licences are sequential
with leading zeros (a real CSLB number has none), DIRs are `10000000xx`, phones are the
reserved `555` range, emails use the reserved `.test` TLD, firm names are invented, and
the four real dollar figures return **zero** occurrences across both files. Only the
layout is copied — box 1 at column 0, the second at 40, the third at 89.

### A cut-off GC name reached the stored column in silence, and the corpus could not see attribution at all

Three gaps the surrounding work found and deliberately left, each now closed with its
proof.

**One: the row said half a contractor's name and admitted nothing.** A bidder line that
wraps WITHOUT a trailing comma is not joined (the continuation is invited only by
`/,$/`), so `listedBy: "Charlie Example Brothers and"` was committed with
`concerns: []`, `problems: []` and `agreed: true`. The page-level `header.prime` has
warned about exactly this for weeks; the row did not. So the spoken claim marked it —
`signals.ts` appends `…` — while the stored column and the screen did not, and the
field beside an honest sentence was the dishonest one.

The existing rule needed no adaptation and was REUSED rather than re-derived:
`looksCutOff(field: string | null)` is a thin wrapper over the single `DANGLING`
expression, it already returns false for null, and `signals.ts` already imports it for
the same purpose. **The mutation that proves reuse mattered rather than being tidy:
replacing it with a punctuation-only `/[,&/+]$/` — which drops `DANGLING`'s word list —
reds the named test.**

**It is a row CONCERN, not a page PROBLEM, and the asymmetry is deliberate.** A problem
would flip `agreed` for a whole page over one bidder among six, and `listedBy` is
per-row precisely so a six-bidder page is read instead of refused. The row's two other
cut-off fields are already concerns. Asserted directly, and the concern fires 0 times
across the 157 real corpus rows.

**Two: every row of all 16 `SUB_LISTING_CASES` parsed to `listedBy: null`, so the shared
corpus exercised no per-row attribution whatsoever** — which is why last night's
wrong-GC defect survived 388 green tests. Two cases added: `two-bidders-one-page` (three
rows, two bidders, the second's name wrapping after a comma) and `bidder-name-wrapped`
(the task-one shape). The first was **MOVED, not copied**, out of an inline literal in
`parseShapes.test.ts` where every `it.each(SUB_LISTING_CASES)` block was blind to it,
with the script asserting byte-identity before the swap — a second copy would have been
the "is there a second list" defect.

`expectListedBy` is OPTIONAL on purpose: declaring all-nulls on the 16 single-bidder
cases would assert nothing. Its vacuity guard has two halves — that some case declares
it at all, AND that some case declares **two different** bidders, because a corpus whose
declared values were all one string cannot tell per-row attribution from a page prime
copied onto every row.

**And the mutation that makes that guard worth having is one a colour-only read would
have misreported.** Deleting both declarations leaves `1 failed` — but the TOTAL drops
**438 → 436**, because the new `it.each` becomes ZERO TESTS. Two assertions ceased to
exist and only the guard noticed. Verified independently here, and the first attempt at
that mutation was a harness failure of the reader's own making: a regex that removed the
first line of a multi-line array orphaned its elements, three files failed to LOAD, and
the total collapsed to 127 — which is a broken instrument, not a result, and was caught
only by reading the total first.

**Three: `FORM_REFUSAL["labelled-columns"]` was unreachable and is deleted**, proved
three ways without reordering the dispatch to make it reachable. Grep finds one reader.
The compiler agrees: narrowing the key type to `Record<"numbered-blocks", string>` still
typechecks with zero errors on `parse.ts`, so TypeScript's own narrowing proves the index
can only be that one key — and the narrowed type re-checks it on every build. And the
mutation has a POSITIVE CONTROL, which is what makes a survivor readable rather than
merely absent: sentinelling the `"labelled-columns"` message survives all 438 tests,
while the identical mutation on its `"numbered-blocks"` sibling reds three. A mutation
that survives where its sibling kills is deadness, not a coverage gap.

Corpus byte-identical at 157 rows / 143 cities / 151 scopes / 20 of 20 headings.
388 → 438 tests. `parse.ts` and `subListingCases.ts` typecheck with zero errors, each
proved non-vacuous by an injected error returning TS2322.

**Two warnings for whoever reads a local typecheck next.** `parseShapes.test.ts` carries
a pre-existing `TS2307` for `vitest`, so everything through `describe`/`it`/`expect` is
`any` here and a wrong `it.each` tuple would not be reported — CI's Typecheck is that
file's only checker. And a **syntax** error in another lane's `lib/actions/sales.ts`
during this work made the whole `tsc` run print **3 lines** and nothing about any other
file: one broken file under `lib/actions/` makes everybody's local typecheck silently
vacuous. Both runs behind this entry were confirmed at 22,778 lines before their content
was read.

Not fixed and flagged: a bidder name wrapping across two lines still cannot be joined,
because only a trailing comma invites the continuation. Extending the join to a trailing
conjunction would put guessed-at text into a stored GC name, which is the opposite of
this file's attributed-never-appended rule. Flagging it is right; joining it is a product
decision.
