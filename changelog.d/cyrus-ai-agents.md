### The assistant gets memory, and four agents that read the bids and advise (Cyrus)
`cyrus/ai-agents`

Until now the Ask box forgot a conversation when the tab closed, and nothing
in the app looked at a bid unless a person typed a question about it. This
branch adds the tables and the spine for both: conversation threads
(`AskThread`/`AskMessage`), and background agents — a bid watcher, bid
research, an estimate check and a recommendations engine — that read what
the company already has, write down what they found WITH SOURCES, and
advise. One additive migration, `20261011120000_add_ai_agents`; no drops.

The rule the whole thing rests on, enforced in code rather than prose:
agents never submit, send or change a bid or an estimate. The only tables
an agent can write are its own (`AgentRun`, `AgentFinding`,
`AiRecommendation`); a business change still goes through the Ask confirm
card. `addFinding` THROWS on a finding with no record or URL behind it, so an
uncited number cannot reach a screen — the run fails and says so on the
timeline instead.

Spend is checked BEFORE a model is called, not after. `agentAllowed` runs the
company AI switch (`aiGate`, feature `AI_AGENTS`), the per-agent switch, then
this month's agent spend priced with the same `spendOver` the settings page
shows, against `CompanyAgentSettings.monthlySpendCapUsd`. Over the cap, the
run is recorded as `PAUSED_CAP` with "Paused: … cap reached" rather than
silently skipped. All four agents record usage under one ledger feature,
`ai-agents`; which agent spent it is on the run row.

The check for each trap: `lib/agents/core.test.ts` proves a company over cap
yields a paused row and no findings, that an uncited finding is refused
before any write, and that a repeat `dedupeKey` writes nothing. The export
census buckets every new model honestly (`BidOutcome` with the bidding it
explains, the rest as AI bookkeeping), and `aiSurfaceCensus` has a rendered
control for the feature from the first commit — `RunAgentButton` on `/ai`.
