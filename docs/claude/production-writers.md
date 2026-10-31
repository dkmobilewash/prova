# Sessions writing to production

Moved word for word from `CLAUDE.md` on 2026-10-30 to keep that file under the size
every session loads. "Above", "below" and "this file" in the text mean `CLAUDE.md`,
where its short entry keeps the rules.

- **MORE THAN ONE AGENT SESSION WRITES TO PRODUCTION, AND ONE OF THEM IS
  NOT ANNOUNCING IT.** Three sightings on `ep-little-sea` in two days,
  4-5 Sep 2026, all on the operator company's own rows:

    - a `SalesActivity` reading "ZZ-TEST Phase C verification call —
      logged by Claude on 2026-09-04 to verify SalesActivity persistence",
      which appeared on a lead BETWEEN a tester's page load and their
      delete attempt — so the delete guard refused a lead they had just
      seen as empty. The guard was right; the data moved underneath them;
    - a `SalesLead` named "CLAUDE-VERIFY Phase C (delete me)" with a
      $1,200/mo opportunity, which sat in the `/sales` pipeline band
      inflating the live figures;
    - a `CompanyLicense` named "ZZTEST Nevada — ZZ-TEST 61A" on
      `/settings`, which is what made the #61 watcher above false-positive.

  **That third one is the cost worth naming: a stray test row did not just
  clutter a page, it corrupted an experiment and nearly produced a wrong
  answer to a question two sessions had already burned days on.** A
  measurement taken on this account is not taken on a quiet one.

  So: **before timing or counting anything on production, screenshot or
  record the starting state of the rows you are about to measure**, and
  say in the report that you did. And if you are the session writing:
  demo-project or scratch database, never `ep-little-sea`; if a production
  write is genuinely unavoidable, post it in Slack BEFORE the write, not
  after, and delete it in the same sitting. The demo project exists
  precisely so this does not have to happen — see the three-Neon-projects
  table above.

  **Cleared 2026-09-07: the CLAUDE-VERIFY lead is gone** — its opportunity
  and activity deleted first, then the lead, by hand through the app. The
  pipeline band reads true again. `deleteSalesLead` refuses while any child
  row exists and names only the non-zero kinds, so a lead like this cannot
  be removed in one click; children first. `ZZ-TEST Pipeline` was reported
  separately and is NOT known to be cleared.

  **THE CAUSE IS STILL UNIDENTIFIED, and here is what has been ruled out so
  nobody spends the afternoon again.** All four checked rather than assumed:

    - **Previews are not it.** They resolve `ep-patient-lake`; only
      production resolves `ep-little-sea`. Confirmed from build logs on two
      unrelated branches plus a production control — see the preview
      paragraph above for the method, which needs no dashboard access.
      This was the best hypothesis, and its stated reason was ALSO wrong:
      it said a preview URL, being a different host from `app.cstream.ai`,
      "would pass the egress proxies that 403 both agents' containers".
      Measured 2026-09-09 from an agent container, twice: the preview host
      was denied exactly like production — `curl` failed at CONNECT and the
      proxy's own status endpoint named it, `connect_rejected`, "gateway
      answered 403 to CONNECT (policy denial)".
      **THAT SECOND GROUND IS NO LONGER TRUE, as of 2026-10-04: the preview
      host answers 200 from an agent container, and a real Chromium drives
      it.** Sixteen public page loads at 375 and 1280, every one hydrated
      and clean. So "an agent container cannot reach a preview" has expired,
      and anyone reading this list to decide where to look next must treat
      the browser route as OPEN again.
      The conclusion of this bullet is unchanged and never depended on it —
      it rests on the build logs above, which say previews resolve
      `ep-patient-lake`. A preview an agent CAN now reach still cannot write
      to `ep-little-sea`. But the elimination has lost one of its two legs,
      which is exactly the shape this file keeps recording: a measurement
      that was honest on the day, cited later as a property of the world;
    - **Scheduled Routines are not it.** One exists on Diego's account, the
      hourly status desk. Disabled, and its prompt is STATUS ONLY — no
      code, no pushes, and no path to the app;
    - **The shared cloud environment does not carry credentials.** Every
      session on it shares one `environment_id`, and one of them has no
      `DATABASE_URL` and no `.env` at all, so the environment injects
      nothing;
    - ~~**The Vercel MCP cannot leak the string.** It has no env-var tool;
      checked twice rather than asserted from a partial search.~~
      **WITHDRAWN 2026-09-28 — THIS ELIMINATION RESTED ON A PREMISE THAT IS
      NOW FALSE.** The MCP has six env-var tools (see the Vercel-MCP
      paragraph under the blob-store entry above, which carries the
      evidence), and two of them describe themselves as returning a
      DECRYPTED value. So "it cannot reach a secret" is no longer something
      this list gets to assert.
      **This is a withdrawal, not a reversal, and the difference matters.**
      What is still true: production `DATABASE_URL` is a `sensitive`-type
      variable, and `filter_project_envs` returns `value: ""` for those —
      observed, not assumed, on 2026-09-28. What is NOT established:
      whether `get_project_env` returns it, which is untested on purpose
      because testing it means decrypting a live database credential.
      So the Vercel MCP is back to UNKNOWN on this question rather than
      cleared — and an unknown must not sit in a list of eliminations,
      which is the whole reason this entry is being rewritten rather than
      quietly deleted. Anyone reading this list to decide where to look
      next should treat the MCP as a live candidate again.

  **THE LEADING HYPOTHESIS HAS NOW BEEN CHECKED AND IS UNSUPPORTED, AND
  THE ROUTE IT WAS HIDING IS DEMONSTRATED.** 2026-09-30. This paragraph has
  said "what survives is a CHECKOUT holding the connection string" in one
  form or another since 2026-09-05 — first as the last of four survivors,
  then as the better-evidenced of two. It was never wrong on its own terms;
  it was never RUN.

  It has been run now, on every checkout on Diego's machine, by the method
  this entry itself prescribes — inside each live session, by whoever had
  it open:

  | ran it | scope | result |
  | --- | --- | --- |
  | this session | `/Users/diego/prova` + 18 worktrees | 185 files name the host; **no `.env` among them** |
  | `Clerk production API keys` | same checkout, 4 `.env` files it had touched | all four name `ep-patient-lake` (demo) |
  | `read-bid-addendum-changes` | `diego-bid-compliance` worktree | its one `.env` holds an API key, no `DATABASE_URL` |
  | `skills-62` | `~/.claude/skills` | no matches, no `.env`, no database |

  Every one of the 185 hits is repo-tracked source: this file and the other
  docs, `migrate.yml`'s deliberately-hardcoded `MIGRATE_EXPECT_HOST`, and
  `db-target.test.ts`/`crew-member.dbtest.ts`, which name the host as a
  literal precisely to assert the scratch guard REFUSES it. None is a
  credential. **No env file on the machine points at production.**

  **What this does NOT do is clear the hypothesis retroactively, and the
  distinction is the whole reason this is written as an audit rather than a
  closure.** It is a snapshot of 2026-09-30; the sightings were 4-5
  September. A checkout that held the string then could have been deleted,
  or its `.env` rewritten, in the twenty-five days between. "Unsupported
  now" is a weaker claim than "it was not that", and this file has an entry
  of its own about the cost of promoting one to the other.

  **THE BETTER-FITTING MECHANISM NEEDED NO `.env` AT ALL, WHICH IS WHY
  TWENTY-FIVE DAYS OF LOOKING FOR ONE FOUND NOTHING.** The three stray rows
  were a `SalesActivity`, a `SalesLead` and a `CompanyLicense` — APP-LEVEL
  records. `migrate.yml` cannot have written them; a migration workflow
  writes schema. What can is an authenticated session against
  **`app.cstream.ai`**, which runs on production's own Vercel variables and
  needs no local connection string.

  That is no longer a hypothesis. `Clerk production API keys` disclosed,
  unprompted, that on 2026-09-20 it created real production rows through
  exactly that route: one drawing set with two revisions and three crew
  schedule days on job ZZQB-TEST, by BROWSER AUTOMATION against the web UI
  signed in as the user, with no psql and no Prisma at any point. It also
  did it correctly — announced in `#prova-build` BEFORE the writes, all six
  rows deleted afterwards and verified on screen, the last schedule day
  only once #401 shipped the control that could remove it. It is NOT the
  culprit: that session postdates the sightings by two weeks and never
  touched the sales models. What it establishes is that the route is real,
  reachable and in routine use on this machine.

  And it fits the evidence the `.env` hunt never did: it explains why no
  env file names production, why the rows are app-level records rather than
  schema, and why they carry hand-written test labels — "logged by Claude on
  2026-09-04 to verify SalesActivity persistence" is the language of
  clicking a feature, not of writing SQL.

  **THE ELIMINATION THAT HID IT WAS TRUE ABOUT CONTAINERS AND WAS READ AS
  TRUE ABOUT EVERYTHING.** The preview/production bullet above eliminated
  the browser route because an agent container's `curl` "fails at CONNECT
  and the proxy's own status endpoint names it, `connect_rejected`". That
  measurement stands and covers containers. **It does not cover a session on
  Diego's laptop, where there is no egress proxy at all** — measured
  2026-09-30, a plain `fetch` from a local Node process to Clerk's API
  returned `HTTP 200`. So "an agent cannot reach production" was never a
  property of agents; it was a property of one deployment of them, and the
  sentence outlived the qualifier.

  The Vercel MCP stays on the board too, unchanged from the withdrawal
  above: still UNKNOWN rather than cleared, still the weakest of the
  candidates, still listed only because "unknown" and "eliminated" are
  different states.

  **TWO MECHANISMS THAT ARE NOT THE CAUSE AND BELONG ON THE RECORD ANYWAY**,
  both volunteered by the sessions above rather than found by grepping:

    - **An agent copied `.env` files BETWEEN worktrees.** 2026-09-26,
      `apps/web/.env` and `packages/db/.env` from `diego+api-auth-seam` into
      `diego-ui-tokens`, so a web build could run. Those name the demo
      endpoint, so nothing leaked — and it is precisely how a production
      string would propagate if one ever sat in one. A credential file
      arriving somewhere it has never been is worth a Slack line.
    - **Every `pnpm build` and every `./scripts/preflight.sh` OPENS A
      CONNECTION** to whatever that checkout resolves to. Not the section
      you would suspect: preflight's "migrations that will hit PRODUCTION"
      report is pure `git diff`/`git status`/`grep` over `migration.sql`
      files and touches no database. It is `pnpm build` one step earlier
      (`preflight.sh:104`) → `check:schema` → `check-schema.mjs:74`, which
      shells out to `prisma migrate status`. That is a READ and cannot have
      written a `SalesLead`, so it is not a candidate — but it means "nobody
      wrote to it" and "nobody connected to it" are different questions, and
      only the first one has been asked.

  **LOCAL PEER SESSIONS ARE REACHABLE, AND THIS ENTRY SAID THEY WERE NOT.**
  It read: *"A cloud session cannot be questioned from another container.
  `ListAgents` sees only this machine, and `SendMessage` to either title
  returns `No agent named '…' is reachable` — tried, not assumed."* Every
  word true, and about CLOUD sessions. Read as a general fact it says the
  one thing that stops anyone trying, and the check above took three
  messages and a few minutes: `ListAgents` listed three peers on this
  machine and all three answered, two of them with disclosures nobody had
  asked for.

  So the prescription is unchanged and is now known to work from outside:
  the check runs INSIDE each session, `grep -rl "ep-little-sea" .
  --exclude-dir=node_modules --exclude-dir=.git`, **reporting the HOST only
  and never the string** — but a peer can ask for it rather than waiting for
  whoever has the window open. Cloud sessions remain unreachable; that half
  needs no correction.
