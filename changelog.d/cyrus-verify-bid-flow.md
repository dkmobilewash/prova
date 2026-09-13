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
