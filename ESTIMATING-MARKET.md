# What the estimating market actually does — reported, not verified

Browser research run 2026-09-20 against eight takeoff/estimating products,
read through a wall-and-ceiling subcontractor's lens. Companion to
`ESTIMATING-AUDIT.md`, which is the reading of our own code.

## Read this paragraph before you use anything below

**Nothing in this file was verified from inside this repo, and nobody here
opened any of these products.** It is a browser session's report of vendor
help centers, release notes, review sites and one university study. The
report tiered its own evidence — A = help-center page with UI screenshots,
B = docs without screenshots or a detailed independent hands-on report,
C = marketing — and marked what it could not establish, which is why it is
worth keeping at all. Those tiers are preserved below.

Treat every line as **REPORTED**. It is good enough to decide a build order
from, because a build order is a bet about where the value is. It is NOT
good enough to write into a product claim, a pitch, or a sentence about a
competitor that somebody outside this company reads. If one of these
findings ever has to be load-bearing, open the product and check it.

Two things the report was honest about that make it more usable, not less:
no genuinely independent hands-on test exists for any of the three AI-first
products, and **no vendor, reviewer or user anywhere in the corpus publishes
a time-to-produce-one-bid figure.**

## The finding that reframes everything

**Every AI takeoff engine surveyed detects the plan-view wall centerline and
stops.** Wall height lives in sections and details. Wall type lives in the
partition schedule. Both are outside the documented envelope of all eight
products.

The evidence converges from five independent directions, which is why this
one is worth believing despite being assembled from separate sources:

| Source | What it says | Tier |
| --- | --- | --- |
| Procore's own help centre | Auto-Area Takeoff "does not support vertical wall areas because the tool identifies closed 2D loops on a horizontal plane" | B |
| ConstructConnect OST docs | Auto Takeoff returns walls as **linear segments only**; floor plans and enlarged floor plans only — not Detail, Section or Elevation | A |
| A STACK user (G2) | "The AI software doesn't take varying ceiling heights into account on a single plan page, requiring us to handle that portion manually" | B |
| A Togal user (G2) | It cannot yet "distinguish between a 2x4 and a 2x6 wall" | B |
| A Kreo user (Capterra) | It cannot "differentiate the different wall types or ceiling types" | B |

So AI takeoff returns **length, not area** for our scope, and no wall type.
Detecting a centerline is the easy part; joining it to the partition
schedule and a height is the part nobody has shipped.

**The direct consequence for C Stream: do not build PDF measurement or AI
plan reading.** It is a commodity eight products already have, it is the
most expensive thing on this list to build, and it demonstrably does not
answer the question our user has. Our existing `lib/takeoff.ts` — somebody
measures, types dimensions, gets quantities — is on the right side of that
line, and its docstring already says why.

One number is sharper than any other in the corpus, and it is about our
trade specifically. The University of Kansas study (Togal vs. On-Screen
Takeoff, Tier B, hosted on the vendor's site) reports ~70% time savings
overall, 76% on a fire station — and **22% on the one Reflected Ceiling
Plan it tested**, 16.7 minutes against 21.67. Acoustical ceiling takeoff is
RCP work. Caveats the authors themselves state: n = 1, the operator was a
first-time user of both tools, and "within 5%" means agreement with another
tool driven by the same novice, not accuracy against ground truth.

## The three-layer split

Measurement → assembly and production-rate engine → bid recap and proposal.
Almost nobody owns all three.

| Product | Measure | Assemblies + rates | Recap + proposal |
| --- | --- | --- | --- |
| Bluebeam Revu | yes | **no assembly feature at all** | none |
| Togal.AI | yes (AI) | no — exports quantities to your estimator | none |
| Kreo | yes (AI) | assemblies yes, rates NOT ESTABLISHED | no recap; BoQ output |
| PlanSwift | yes | assemblies yes, rate field NOT ESTABLISHED | per-part markup, no recap |
| STACK | yes | yes — assemblies + Coverage Rate | partial (6 cost categories, free-text proposal) |
| Procore Estimating | **cannot do walls** | yes — unit labor × difficulty | **best recap + only structured exclusions** |
| Sage Estimating | **none** | **deepest** | deepest indirects, **no GC-facing proposal** |
| OST + Quick Bid | yes | yes | yes |

Only OST + Quick Bid spans all three, which is the report's explanation for
why a twenty-year-old Windows product is still the incumbent in this trade.
**Every product leaks at the seam between takeoff and pricing.**

Bluebeam is the sharpest illustration: its own blog post titled "How
Estimates for Assemblies Are Possible in Revu" documents a workaround and
then concedes "you would want to link the measurement data and build the
formulas in Excel rather than Revu." The vendor is telling you to leave.

## Labor production rate is the line between a takeoff tool and an estimating tool

This is the finding that settles an open question in our own code.

| Product | Production rate | Shape |
| --- | --- | --- |
| Quick Bid | first-class | Qty/Hr-Day or Pcs/Hr-Day on Master Items via Labor Cost Codes; editable at bid level and per item; baseline production % |
| Sage Estimating | first-class | **hours-per-unit OR units-per-hour**, a spreadsheet column, plus a separate Productivity Adjustment factor and licensed Crews with rate tables |
| Procore Estimating | first-class | `Total Labor (hrs) = Quantity × Labor (hrs) × Difficulty` — unit labor on the item, overridable |
| STACK | yes | editable "Coverage Rate" against labor items with a Purchase Unit of Hours |
| PlanSwift | **no field** | author it in a Pascal formula |
| Bluebeam | **no** | hard-code it in a formula column |
| Togal / Kreo / Handoff / Buildertrend / JobTread | **no** | — |

**Every product that is an estimating tool rather than a measuring tool
stores the rate PER UNIT.** Nobody stores a flat per-line hours figure. Two
of the four express it as a rate with a separate multiplier for conditions
— Sage's Productivity Adjustment, Procore's Difficulty — which is how
height, access and occupied-building work get priced without corrupting the
base rate.

That is the answer to `changelog.d/cyrus-catalog-labor-hours-meaning.md`'s
open question, arriving from outside. It does not make the decision —
Diego does, and it needs a migration announced in Slack first — but the
evidence is now one-sided, and `importCatalogEntries` (which maps a
per-unit column in) is the writer that matches the market while
`saveLineItemAsCatalogEntry` (which copies total hours) is the one that
does not. `Decimal(8, 2)` cannot hold a per-unit rate and would need to
grow.

## Markup, overhead and profit — four reference designs

We have none of this. Here is what the mature products do.

- **Quick Bid** — Section Markups are Escalation, Tax/Burden, Overhead,
  Profit, applied across Material / Labor / Subs / Equipment / Other.
  Escalation "affects selling price but not the base unit cost". Burden is
  computed from Payroll Settings. **Overhead is part of the cost base, so
  profit calculates on top of overhead.** Straight vs. Gross markup method
  is selectable per bid — i.e. markup-on-cost vs margin-on-price is an
  explicit setting, not an assumption. (Tier B, no screenshots.)
- **STACK** — six additional-cost categories: Direct, Indirect,
  Contingencies, Overhead, Profit, Tax. Each is Lump Sum or Percentage, and
  a percentage can target the estimate base total, the extended costs, or
  **a chosen cost type or label** — that targeting is the mechanism for
  differential markup. (Tier B.)
- **Procore Estimating** — per-cost-type markup, Overhead %, Discount,
  separate Labor Tax and Material Tax, **Bonding computed on (Sales +
  Adjustments + Taxes)**, Lost Time & Waste per cost type, plus custom
  pre- and post-tax markups. (Tier B.)
- **Sage Estimating** — indirects as named Addon objects: Insurance, Surety
  Bond, Taxes & Insurance on Labor, Sales Tax, Overhead & Profit, with a
  dedicated bond-cost-basis topic. The most complete apparatus found.
  (Tier B.)

The common shape across all four: **markup is per-cost-type, applied at the
bid level, as an ORDERED STACK, with overhead entering the cost base before
profit, and bond computed last on the marked-up total.** Build it as an
ordered list of typed adjustments, not as one percentage field.

## The proposal layer is the widest open gap

Exclusions are the spine of a sub's bid, and almost nobody models them.

| Product | Inclusions / exclusions / clarifications | Alternates & unit prices |
| --- | --- | --- |
| Procore Estimating | **the only structured library found** | in proposal templates |
| Quick Bid | **no merge fields** — static text you retype into a Word template | first-class, merge into the proposal |
| STACK | reusable free-text Scope of Work and T&C blocks | NOT ESTABLISHED |
| Bluebeam / Togal / Kreo / Sage / PlanSwift | nothing | nothing |

Sage — the deepest estimating engine in the survey — produces **no
customer-facing proposal at all**; its "Create Proposal" is an export into
Sage 100 job cost.

The report's own judgement, and it matches ours: treating exclusions,
clarifications, alternates and unit prices as structured, versioned,
reusable objects rather than prose is wide open, and **cheap relative to a
takeoff engine.**

## Revision handling is unsolved everywhere

Every product ships the same thing: a colour-coded visual diff the
estimator aligns by hand, then redoes the affected takeoff.

- STACK states outright that takeoff done in overlay mode "will be added to
  your original, base layer" — no re-quantification.
- Bluebeam's Batch Slip Sheet copies markups **geometrically**. If a wall
  moved, the measurement lands at the old coordinates and reports a
  confident wrong number.
- OST models revision sets and matches updated sheets to existing sheet
  numbers, but whether takeoff carries forward, or a quantity delta is
  computed, is NOT ESTABLISHED in its docs.
- The single claimed exception — eTakeoff Bridge "automatically finding
  changed takeoff measurements" while preserving pricing, crews and waste —
  is Tier C vendor copy with no screenshots. The report flags it as the
  most valuable feature in the survey *if* it were demonstrated.

A sub re-bids through three addenda before bid day, and nobody has priced
that. **We have the easy version of this problem**, because we have no PDF
canvas: if takeoff INPUTS are stored, a changed wall height is an edit, not
a re-measure. That is audit gap #2, and it is now also a competitive gap.

## Cost data, and the second open gap

Two sources exist and everyone else has nothing built in: **BNi** (bundled
free with a paid STACK account — 10,000+ items, 600 US regions, annual
updates, each item carrying crew daily output) and **RSMeans** (Sage, via
the Means Integrator with city cost indexes).

**Structured supplier-quote ingestion is absent from every product surveyed
except Sage's Bid Grid** — despite a wall-and-ceiling sub pricing board,
stud and grid off negotiated supplier quotes rather than a national index.

We already have the model for this. `VendorPriceQuote` exists, hangs off a
catalog entry, and nothing reads it into an estimate (audit gap #9). That
moves it from a nice-to-have to a gap the market has left open.

## Setup cost is the real barrier, and it is our opening

Nobody publishes time-to-bid. What IS documented is that the cost is
front-loaded into setup:

- a PlanSwift user needed **"a full month to build assemblies properly"**;
- a Sage enterprise reviewer advises expecting **"2 to 3 years"** before
  full satisfaction;
- PlanSwift's Drywall & Framing Starter Pack ships metal stud, track,
  channel, drywall, acoustical tile, labor and subcontract parts — and
  **"does not include industry pricing for materials and labor"**;
- STACK ships "over a hundred basic, pre-built assemblies", and the only
  named packs are Concrete and Roofing. Shipped wall/ceiling content:
  NOT ESTABLISHED for STACK, OST/Quick Bid and Procore alike.

So every product that ships assemblies ships them unpriced, and **not one
product in the survey is documented as shipping wall-and-ceiling trade
content.** The honest competitive claim for C Stream is therefore not
"faster bids" — it is **"usable on day one without a database build"**, and
none of the incumbents can say that.

We already have two of the three pieces of that story: the catalog builds
itself from real priced lines, and `catalog-actuals` feeds real job costs
back into it. The missing third is shipping starter content for the five
trade scopes.

## Prices, for reference

| Product | Price |
| --- | --- |
| Bluebeam Revu | $260 Basics / $330 Core / **$440 Complete (realistic floor)** / $590 Max, per named user per year. Perpetual licences ended Sept 2023; Open Licensing discontinued |
| Kreo | $35 Lite / $70 Plus / **$175 Pro** per user/mo annual |
| ConstructConnect Takeoff (cloud) | $1,200/yr Starter, $2,200/yr Professional per seat |
| PlanSwift | $2,000/yr Essential (no Auto Takeoff) / **$3,000/yr Core** per seat |
| Togal.AI | $299/user/mo billed yearly |
| STACK | **$299/user/mo annual for Pro** — and Pro is the tier that has estimating, assemblies, BNi and proposals (≈$3,588/seat/yr) |
| OST / Quick Bid / Procore Estimating / Sage | not published |

## What this does NOT tell us

Worth writing down so nobody assumes it was covered:

- **No time-to-produce-one-bid figure exists anywhere.** If we ever want to
  claim we are faster, we will have to measure both sides ourselves.
- **Shipped wall-and-ceiling assembly content is NOT ESTABLISHED for every
  product that could plausibly have it.** We do not know whether the
  incumbents ship a metal-stud partition library or whether every shop
  builds its own. That is the single most useful unanswered question for
  deciding how much starter content we owe a new account.
- Every accuracy figure any AI vendor publishes is Tier C with the
  methodology NOT ESTABLISHED — Togal's 98%, Kreo's 94%/98.5% (two
  unreconciled numbers from the same vendor), Handoff's 81.6%/93.5% (also
  unreconciled, on a self-created self-scored benchmark).
