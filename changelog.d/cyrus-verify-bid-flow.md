### The badge on a drafted estimate line now describes the price actually stored (Cyrus)
`cyrus/verify-bid-flow`

Walking the "build a bid from one sentence" path end to end for a demo
scene, rather than to fix anything. The path holds up. One thing in it did
not, and it is the part the scene exists to show off.

A drafted line carries a `priceBasis`, and the job page renders it as a
badge: green **"Your catalog price"**, blue **"From your past bids —
verify"**, amber **"AI guess, no company data — check the price"**. That
badge is the most trustworthy sentence in the product — a tool that admits
it does not know what something costs beats one that quietly invents a
number — and it is only true while the badge describes the figure printed
beside it.

Two files decided those two things and nothing reconciled them.
`packages/integrations/src/anthropic.ts` normalises the basis the MODEL
claimed, and it is careful about it: a catalog claim with no verified entry
behind it degrades to the weakest basis, because "a COMPANY_CATALOG badge on
an invented number is precisely the false confidence this basis field exists
to prevent". But the number itself is chosen one file later, in
`apps/web/lib/estimating/draft-lines.ts`, which overrides the model's price
with a matched catalog entry's own default — and then copied the model's
basis through untouched.

So both directions of disagreement were reachable, and the dangerous one is
reachable from an ordinary catalog:

- a catalog entry with **no default price** (the app has a whole preview
  line for these — "No default price on the catalog entry"), matched and
  claimed as `COMPANY_CATALOG`: the entry prices nothing, so the number
  written is the model's own invention — wearing the green "Your catalog
  price" badge. Exactly the failure the field was added to prevent, arriving
  through the one code path that did not know about the rule;
- a catalog entry **with** a default price and any other claim: the number
  written is the company's own, badged amber "AI guess, no company data", or
  — with no claim at all — grey "AI-drafted, unpriced" next to a price.

`priceBasis` is now derived where the price is chosen (`priceBasisFor`), so
the label and the figure come out of the same branch. Priced from the
catalog's own default is `COMPANY_CATALOG`; priced from the model is
whatever it claimed, with a catalog claim it cannot support degraded to
`GENERAL_KNOWLEDGE` — the same rule `anthropic.ts` already applies, now
applied to the price actually stored rather than to the price proposed; no
price at all is no basis at all. That is this repo's own rule about derived
state, which `priceBasis` is: a stored label that can disagree with what it
was derived from eventually does.

The check: `apps/web/lib/estimating/draft-lines.test.ts`, eleven cases
against a fake Prisma — no database, no model call. Four of them fail on the
old code, and the first one fails with `expected 'COMPANY_CATALOG' not to be
'COMPANY_CATALOG'`, which is the green badge on a made-up number, asserted.
Mutation-checked by putting `priceBasis: item.priceBasis` back and watching
the same four go red. The file also asserts the SIZE of the row set it
reasons about against the number of lines the drafter returned, because a
mapping that silently dropped a line would otherwise satisfy every
assertion in it.

Nothing else in the path was changed, and nothing was clicked: the only
writable database holds the demo data being filmed, and creating an estimate
job moves the dashboard's "Bidding" figure. The click-list is Cyrus's to
run.

### The badge survived being acted on — correcting the price left the claim behind (Cyrus)
`cyrus/verify-bid-flow`

Same branch, one step further down the same path, and the defect is the
first one's mirror image. The badge was made honest at the moment a line is
drafted. Nothing carried that honesty past the next thing a person does
with it.

The amber badge says **"AI guess, no company data — check the price"**. Its
entire purpose is to send the estimator to that price box and have them
type a real number. `updateLineItem` wrote their number and touched neither
`aiDrafted` nor `priceBasis` — so the badge asking them to check the price
stayed sitting on the price they had just checked, permanently, and
`priceBasis` went on naming a source the figure no longer came from.
Nothing in the app can clear either field; there is no review action, no
approve button, no other writer.

The green one is worse and needs no AI at all to reach. Add a line from the
catalog at $3.25, decide this gym is a $4.40 job, type 4.40, save: the row
still reads **"Your catalog price"** over a number the catalog never held.
That is a false provenance claim on a figure that goes to a GC, produced by
the ordinary act of pricing a bid.

The rule now: **a price the estimator typed is the estimator's, whatever
drafted it.** Changing the figure clears the basis and the drafted flag —
there is no enum value for "the estimator's own number" and there should
not be one; the row simply stops claiming anything and stops being a
machine's draft. Changing only the wording or the quantity leaves both
alone, because the price is still the machine's and still wants checking.
The comparison is by NUMBER (`priceChanged`, `lib/estimating/price-claim.ts`),
since the row holds a `Decimal` and the form posts the digits a person
typed — "3.250" and 3.25 are the same price, and a comparison that called
them different would retire the claim on every save, including the saves
that never went near the price.

One more, found while pinning that down and fixed with it: `addCatalogLine`
stamped `COMPANY_CATALOG` on every line it created, including a line from
an entry with **no default price** — whose own confirm card reads "No
default price on the catalog entry" and whose row lands with `unitPrice:
null`. A basis is a claim about a price; no price, no claim. Nothing
renders that badge today (`PriceBasisBadge` is drawn for `aiDrafted` rows
only), so it is a stored contradiction rather than one on screen — said
plainly rather than dressed up, because a vivid failure nobody can reach
makes the boring one underneath it look optional.

The check: `apps/web/lib/estimating/price-claim.test.ts`, ten cases against
a fake Prisma, driving the real `updateLineItem` and the real
`addCatalogLine` rather than a copy of their logic. Three fail on the old
code; the first fails with `expected 'GENERAL_KNOWLEDGE' to be null` —
the amber "check the price" badge on a checked price, asserted. Mutation-
checked twice, once per fix, by disabling only the source line and watching
the same tests go red. The form fixture posts every field with the value
already on the row, which is what the job page's own form does, so "saved
without touching the price" is a case the file can actually express.

Still not clicked, for the same reason as above.
