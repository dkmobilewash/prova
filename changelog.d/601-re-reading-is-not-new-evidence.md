### Re-importing one listing tripled its claims, and could un-reject a dismissed one (Cyrus)
`cyrus/sales-signals`

The cross-import merge fixed the lead count and left the evidence alone. Three imports of
one document produced ONE lead — correct — carrying **fifteen PROPOSED signals over five
distinct claims, each tripled**. The reviewer confirms the same sentence three times, and
the lead stays undeletable, which is the cost the merge existed to remove. Measured by
review, not inferred.

**The duplication is the visible half. The half that matters is that a dismissed claim came
back.** Nothing compared a proposal against what the lead already held, in any state — so
a sentence somebody had read and DISMISSED was written again as PROPOSED by the next
import of the same document. A rejected claim returning un-reviewed is the review step
being undone by a re-read, and on screen it is indistinguishable from fresh evidence.

`(leadId, sourceUrl, kind, claim)` is the natural key of a piece of evidence and nothing
honoured it. It is honoured in the one function that writes these rows, **without a
migration**: a unique constraint would have to be announced in Slack before the push, and
the rule does not need the database's help to be kept.

Three deliberate choices in that key, each with a test that fails if it changes:

- **No state filter.** The query reads CONFIRMED and DISMISSED rows too, which is the whole
  point — filtering to PROPOSED would fix the duplication and leave the resurrection.
- **The claim, not just the kind.** An agency re-posting a corrected listing at the same URL
  is the case this allows: the wording changes, so the sentences are new evidence and land.
  Keying on the kind alone would swallow the correction.
- **Scoped to the source.** Two documents reporting the same fact are two pieces of
  evidence. Their claims differ anyway, because each names its own project and line.

The set is read once per lead and then kept, because several rows of one paste land on one
lead and it has to include what this paste has already written.

49 db tests, up from 46. Four mutations, all killed, and the map from mutation to test is
the evidence that none of the three is decoration:

| mutation | reds |
| --- | --- |
| the filter never fires | the second-import case **and** the dismissed case |
| the query filters to `state: "PROPOSED"` | the dismissed case **only** |
| the key forgets the claim | the correction case, and 5 existing tests |
| any prior signal from this source blocks the row | the correction case, and 5 existing tests |

The second-import test asserts `leadsCreated: 0` and `leadsAttached: 1` before it asserts
`signalsProposed: 0`, so it cannot pass by the import having failed to find the lead —
which is the shape that would make the whole case vacuous.

**What this does NOT fix.** A lead whose every claim is already on record still counts as a
lead you already had and still shows on the screen's summary line, which is right. And the
fifteen signals already written by a previous triple import are not cleaned up: deleting
evidence is not something this feature does, per the evidence-record rule, so an existing
pile stays until somebody dismisses it by hand.
