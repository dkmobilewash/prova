### The Vercel MCP grew environment-variable tools and three sentences here still said it hadn't (Diego)
`diego/vercel-mcp-env-tools-audit`

**DOCS-ONLY AUDIT**, under the exception Diego granted 2026-09-07. No code,
no schema, no migration. It corrects a documented claim that is now false
and says which, with the evidence — the narrow thing that exception admits.

**The claim.** CLAUDE.md said, in bold, that *"the Vercel MCP has no
environment-variable tool — projects, deployments, build and runtime logs,
deployment protection, domains and analytics, and nothing that reads or
writes an env var (checked three times now, most recently 2026-09-09)"*,
and repeated it a second time as a line item in an open investigation.

**It has six.** Read out of the tool schemas rather than remembered:
`filter_project_envs` (with a `decrypt` parameter), `get_project_env`
(whose own `id` parameter reads "to get the **decrypted value**"),
`create_project_env`, `edit_project_env`, `get_shared_env_var`
("Retrieve the **decrypted value** of a Shared Environment Variable"), and
`update_shared_env_variable`.

**Established by use, which is why this is an audit and not a re-reading.**
On 2026-09-28 `filter_project_envs` returned every variable on `prova-web`,
and `edit_project_env` WROTE a new `CRON_SECRET` — confirmed by `updatedAt`
moving, not by the call returning without an error. That write is how a
two-hour production deploy freeze was cleared the same evening, so the
capability turned up in the course of using it rather than in an audit
looking for something to correct.

**Nobody was careless, and the shape is the reusable part.** The sentence
was checked three times and was true every time. What changed was the tool
surface underneath it, which nothing in this repo watches and nothing
announces. That is a claim about an EXTERNAL capability, and this file has
no way to notice one of those going stale — unlike a claim about the code,
which a test can pin. The only defence is to re-check before relying on
one, which is what the entry now says to do.

**The second instance is the one that mattered, and it is a WITHDRAWAL
rather than a correction.** The claim also sat in the eliminations list of
*"MORE THAN ONE AGENT SESSION WRITES TO PRODUCTION"* — an investigation
that is still open — as *"The Vercel MCP cannot leak the string. It has no
env-var tool."* That elimination rested entirely on the premise, so it goes
with it.

Deliberately NOT reversed into an accusation. What is observed: production
`DATABASE_URL` is a `sensitive`-type variable and `filter_project_envs`
returns `value: ""` for those. What is untested: whether `get_project_env`
reaches it — and it stays untested, because the experiment is decrypting a
live database credential to settle a documentation question. So the MCP
returns to **UNKNOWN**, not to guilty, and the entry says so in those words.

An unknown sitting in a list of eliminations is this repo's most-repeated
defect wearing yet another hat — the `gh pr checks` green about a commit
nobody asked about, the watcher whose needle was already on the page, the
verifier that counted "never ran" as "refuted". Same error: a state that is
not a pass, filed as one.

**One consequence followed and is fixed here too.** The investigation
concluded *"What survives is a CHECKOUT holding the connection string"* —
a fair reading of four eliminations and not of three. It now names two
survivors, says which is better evidenced and why, and says explicitly that
the MCP is the weaker of them so nobody inverts the priority on the
strength of this correction.

**`CHANGELOG.md:3930` carries the old claim and is deliberately left
alone.** It is a record of what was believed on the day it was written, and
a PR does not edit it.

**What is NOT claimed:** no test guards any of this, and none can — every
statement here is about a capability living outside the repo. The entry
dates itself and names the date it was verified, which is the only honest
form available.
