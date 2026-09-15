### Three model callers were spending money invisibly (Cyrus)
`cyrus/integration`

A four-agent audit of the AI cost surface refuted the premise it was given.
`AskUsage` recorded the Ask box and nothing else — but this app has **four**
model call sites, and the other three reported no usage at all:

| Caller | Cost | Was capped? | Was in the usage page? |
| --- | --- | --- | --- |
| Ask | $0.03–0.19 | yes | yes |
| `extractComplianceDocument` | **$2.25–4.50** | no | no |
| `generateWipNarrative` | per click | no | no |
| `draftEstimateLineItems` | per confirm | no | no |

So `/settings/assistant` reported a number that was **not the bill**, and
reconciling it against the Anthropic invoice would have shown a gap with
nothing to attribute it to.

The worst of the three is compliance extraction: it base64-encodes a file of
up to 15 MB into one request, which is 50–90× a warm Ask question, with no
rate limit, no page-count check and no owner gate. A contractor uploading
twenty COIs and licences during onboarding is $45–90 in an afternoon.

**A callback, not a database import.** `@prova/integrations` is the outbound
edge and must not gain persistence, so each function takes an optional
`onUsage` reporter and the call site — which already holds the company and the
user — writes the row. `passes` is always 1: none of the three loops. Usage is
reported BEFORE the result check in all three, because a call that came back
without a usable answer still cost the money, and a bill that counts only
successes is the same understatement this change exists to end.

**`AskUsage.feature`**, defaulted to `"ask"`, additive migration
`20260914200000_add_ask_usage_feature`. Every existing row IS an Ask row, so
the default backfills them correctly with no data migration. A union type in
TypeScript rather than a free string (unlike `outcome`, which carries a
model-supplied reason): the set of model CALLERS is a fact somebody has to
write code to change, so adding one should make the compiler ask which it is.

**The half that could have gone wrong quietly.** `askAllowance` now filters
`feature: "ask"`. Without it, putting these three in the same table would
make the Ask ceilings count them — uploading four compliance documents would
silently cost a person four of their hourly questions, a limit tightening
itself as a side effect of a metering change nobody would connect to it. The
dbtest fills the hourly allowance to one short, fires ten compliance rows,
asserts the person is still allowed, then asserts one more real question does
close it — so it cannot pass on a limit that never fires. Mutation-proved by
removing the filter: it fails by name, "ten compliance uploads took ten of
this person's questions".

**Not done here, and deliberately:** these three are now METERED, not CAPPED.
`ASK_LIMITS` is a row count, which is the wrong instrument for a caller whose
calls differ by 90× in price. The audit's recommendation is a dollar-denominated
fuse inside `askAllowance` — implementable in one function, since every token
field and the model id are already on the row and both indexes exist. That is
a separate change and it should be made against real usage, not against the
14 rows this was measured on.

typecheck 4/4, lint 4/4, test 173 files / 2949 tests, build ✓, dbtest 5/5
against a real Postgres.
