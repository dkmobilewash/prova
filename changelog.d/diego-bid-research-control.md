### Bid research had no button anywhere, and now it has one on /pipeline (Diego)
`diego/bid-research-control`

`BID_RESEARCH` was built, gated, metered and model-routed in step 0, and the only
way to reach it was to know how to phrase a sentence at the Ask box — it ran
inside the start-a-bid command and nowhere else. No page had a control. An audit
of the estimating lane on 2026-10-01 put it at 2 of 4: real prompt, real gate, no
UI, no eval. A contractor who never typed at the assistant could not use a feature
they were paying for.

**Where it went, and why there rather than on a bid.** `/pipeline`, above the chase
list, because that page's own header says what it is for — "what we are chasing
before anybody invites us" — and the seven fields research can return map almost
exactly onto `BidPursuit`: owner, architect, GCs bidding, bid date. Research is
worth most BEFORE an invitation, which is also the moment the contractor has least:
a project name heard from somebody, and a city. On `/bids` it would arrive after
the GC has already sent the documents.

**It writes nothing.** The action returns suggestions; a lookup nobody acts on
leaves no row at all. Ticking what you believe and pressing "Track this" opens the
ORDINARY pursuit form, prefilled, and the save goes through `createBidPursuit` —
the same action, the same validation, the same refusals as the hand-typed form.
There is deliberately no second writer for those rows. `BidPursuitFields` gained a
`prefill` prop rather than a synthetic `PursuitRow`, because that type carries an
id and six derived flags and inventing an id to reuse a form is the kind of
convenient lie that ends up in a query.

**The bid date is never prefilled into the date field, which is the one place this
does less than it could.** A date printed on a plan-room page is not the user's
assertion about when their bid is due; the found value is free text as printed
("Nov 14", "late spring"); and a wrong bid date is the most expensive field on a
pursuit — `bid-responsiveness.ts` exists because a late bid is rejected unread. So
it is shown, carried into the note with its source, and the person types the date
they are willing to be held to. `project-lookup.test.ts` asserts it, because a
deliberate refusal to do something the schema allows is one helpful edit from being
undone by somebody reading the gap as an oversight.

**What goes out is on screen.** The two inputs are the whole of what leaves: the
project name and the location, as typed. `research.ts` enforces that by signature,
and the panel says it in a sentence under the form rather than only in a comment —
a feature that searches the public web on your behalf should not have to be read
about in the source.

**The eval, and it is not like the others here.** Every other `*.eval.ts` in this
repo runs against synthetic fixtures. This one queries the LIVE public web, because
the feature's whole job is to read pages nobody here wrote. So only the invention
assertion is fatal — it is the only one that stays true as the web moves — and no
assertion names a specific owner or architect, which would be a test of today's
search rankings with an expiry date on it.

    bid-research eval (bid-research.1, claude-opus-5): requested 3, returned 3
      facts: 5 over 3 cases, 7 web searches
      project-that-does-not-exist    0 fact(s), 2 search(es)
      real-public-project            5 fact(s), 2 search(es)
      generic-name-many-matches      0 fact(s), 3 search(es)

The invented project — a plausible-sounding facility that does not exist — returned
nothing after really searching, which is the promise ("a blank field is correct; a
guess is wrong") holding where no code-level rule could enforce it: a fact lifted
off a page about a *different* hospital expansion arrives with a working link and
passes every citation check this feature has. The generic name was declined too.

**The counter-metric is in the case list from the first run, on purpose.** A
researcher that returned nothing, always, would score perfectly against that
paragraph. The draft-lines eval shipped with exactly that hole last week and its
first run was green while 11 of 19 lines came back unpriced. So one case is a large
public project the web documents heavily, it returned 5 well-sourced facts, and the
report prints a WARNING when that case comes back empty — because then the invention
pass is unproven rather than clean. `searches > 0` is asserted for the same reason:
a workspace without web search would otherwise score "found nothing, correctly".

**Four censuses caught four real defects in this work, which is the part worth
recording.** None was found by reading the diff:

- `theme-contrast` — the button shipped `text-ink-on-brand`, a token that does not
  carry the measured label. Brand is the founder-approved yellow; white on it is
  **1.53:1**. This is CLAUDE.md's own scar arriving again in new code, and the
  census named the file and the required class.
- `formActionCensus` — both forms used `<form action={fn}>`, which React 19 RESETS
  before the action resolves. This action's refusals are its whole error path, so
  "give a city or state as well" would have rendered above two fields it had just
  emptied, telling somebody to add a city with the project name gone too. Now
  `onSubmit` + `preventDefault`, and nothing is reset on a refusal.
- `action-capability-guards` — reported the action as unguarded when it was
  guarded, and the reason is worth knowing: it finds a body by taking the first
  `{` after the function name, and an inline object type in the return annotation
  (`ActionResultWith<{ … }>`) IS that brace, so it read the signature as the body.
  Fixed here with a named type. It fails in the safe direction — a false alarm,
  never a false pass — so the shared guard is left alone; but the tempting way to
  silence that alarm is to add the action to the census's own exception list, which
  would exempt it for real. Said out loud in the action's header.
- `action-capability-guards` again, then `commands.coverage` — the refusal must use
  the shared "part of your job function" sentence, because that is how the census
  tells a capability refusal from an action failing for one of a dozen other
  reasons; a refusal in my own words looked identical to no refusal. And a new
  actions module must decide whether it is an Ask command. It is not, with the
  reason in `exclusions.ts`: it writes nothing, so there is no proposal to confirm,
  Ask already researches inside start-a-bid, and it bills a per-search web charge.

Checked: `typecheck`, `lint`, **8,456 unit tests over 532 files**, all green. The
eval is run by hand with a key, like every other one here: `pnpm eval:bid-research`.

**Not done here:** `LEAD_SEARCH` is the last feature still at 2 of 4, with the same
two gaps. A census asserting that every `AiFeature` has a product caller — the
`stageReachableCensus` shape, which is what would have caught this gap and the
plan-ingest one — belongs with that PR, where it can pass over all nine rather than
fail on the one that is left.
