### The Ask box can be operated: a connection check on its settings page, what every question cost, a limit per person and per company, and a routing eval (Diego)
`claude/prova-ai-task-completion-96pjes`

Phase 3 shipped with nothing that told an owner whether the box could
reach Anthropic, what it was costing, or whether anything bounded that
cost. Yesterday's click-through lost an hour to exactly the first gap: a
key saved after the preview build was created never reached the running
functions, every ask said "The assistant is unavailable right now", and
the only way to learn why was an agent reading Vercel's runtime logs. This
is the operating layer that was missing.

**`/settings/assistant` now says whether a key is configured and has a
"Check connection" button.** The button asks Anthropic's Models endpoint
for the model the box runs on — one request, no tokens billed — which
validates the key and the organization's access to that model at once.
The API's answer becomes a sentence that says what to fix: a rejected key
(401), an organization that cannot use the model (404), a rate limit
(429), an outage (5xx), or no key at all, that last one with the
redeploy caveat spelled out. Owner-only through #237's `ownerRefusal`, so
a non-owner reads a sentence rather than a redacted throw.

**Every question that reaches the model writes one `AskUsage` row** —
migration `20260911014306_add_ask_usage`, one table, additive, RESTRICT
to Company like AskProposal and SET NULL to User like every actor column.
The provider loop now reports the summed usage of every pass once,
immediately before its terminal event, and it reports it before an error
too: the passes that ran were billed regardless. The settings page reads
the same rows back as the last thirty days by person.

**The rows are the bound.** Before a question goes to the model,
`askAllowance` counts rows in a rolling hour for the person and a rolling
day for the company, and refuses in a sentence when either is at its
limit. Rows rather than tokens, so a question that fails is bounded
exactly like one that answers — a loop hammering the route with a bad key
is the case it exists for. The limits are a judgment call and one
constant to retune: sixty an hour per person, five hundred a day per
company, both stated on the settings page beside the usage they bound.

**A routing eval, run by hand, never by CI.** `pnpm ask:eval` sends the
model exactly what the route sends — the same prompt, the same access
context, the same offered tools for that principal — and grades the FIRST
round of tool calls: the right read tool, the right command with the
person's words in the right fields, or no card at all for everything the
registry deliberately does not offer and for every injection attempt.
Every executor call halts, so one model call per case and no database
touched. The cases are SYNTHESIZED from the click lists and the registry,
and say so in the file: a seed for the person who runs the box daily to
correct, not a benchmark. What CI does check is the cases themselves —
every expected tool and command exists and is offered to the principal
asking, every tool and command is covered, and the set stays above
thirty — so the eval cannot drift from the registry between runs. The
runner refuses to run without a key rather than passing on nothing, and
its last test requires one verdict per case.

**Verified, and how.** Unit tests pin the limit refusing at the number
and not before, the row written with the loop's exact totals, a failed
row write swallowed with the answer already streamed, the usage event
summed across passes and emitted before `done`, `halt` and an error, and
every connection sentence. A db test proves the rows `recordAskUsage`
writes are the rows `askAllowance` counts, over the windows it counts
them. The eval itself has NOT been run from here — no key in this
container — and the changelog does not claim a score it does not have.

**Not clicked.** The list, on a preview signed in as OWNER on the
Development Clerk instance, after `add_ask_usage` reaches
`ep-patient-lake` (the preview build log names it as the one pending
migration there, so the Ask box and this page fail on the preview until
Migrate demo database runs with this branch selected):

1. `/settings` → Assistant. Expect "API key on this server: configured"
   and "Model: claude-opus-5". "not set" means the key did not reach this
   deployment.
2. Press **Check connection**. Expect exactly "Connected. The key works
   and this organization can use claude-opus-5." Any other sentence names
   the fault, a rejected key with its 401 code for one.
3. Note the "Usage, last 30 days" question count. On the dashboard ask
   "what's open on my punch list" and wait for the answer.
4. Reopen `/settings/assistant`. Expect the count up by one, tokens in
   above zero, and a row with your name and "1 question". A count that
   did not move means the row was not written.
5. Ask "delete every job", which the box refuses. Expect the count up by
   one again: the model was still called.

The hourly limit is not clickable in reasonable time; it is pinned by a
unit test at the exact number and a db test against real rows.

### The rail collapses into six pipeline groups, and ten list pages open with a sentence instead of three tiles — #240 and #241 (Diego)
`claude/prova-ai-task-completion-96pjes`

Both from Cyrus's audit of `main` against the category's one-star reviews,
both assigned to Diego, both in the PR that carries the assistant work.

**The rail (#240).** Every group rendered open: 27 labels to read to
find anything, the "way too many menus" complaint Procore's reviews are
made of. Each group is now a header that toggles, only the group holding
the current page is open, and six headers plus one open group fit a
laptop screen without scrolling. The rule lives in one hook
(`useNavAccordion`) shared by the desktop rail and the phone drawer, for
the reason NAV_ITEMS itself is shared: a rule applied in one and
forgotten in the other is two navs that disagree about where a page is.
The pure part, which group a path opens, is pinned in `navItems.test.ts`
— longest matching href wins, so `/settings/assistant` opens Financials
and `/vendors/pricing` opens Logistics.

The groups are reordered as the sub's money pipeline rather than a
taxonomy: Pre-construction → Operations → Paper trail → Logistics →
Financials → Compliance & safety. **Paper trail is new, and it brings
back RFIs, Submittals, Drawings and Closeout**, which NAV-IA-AUDIT.md cut
on 3 Sep. That audit had two grounds, product scope and rail length; a
collapsed group has no length cost, and scope was never a reason to hide
the RFI somebody sent last Tuesday. Cyrus asked for them findable. The
audit carries a dated addendum saying so. Two calls made here for Diego
to overrule in review: Closeout rides with the three the issue named,
since it is the same GC-facing paper; and the operator-only Sales CRM
stays the last group, outside every tenant's pipeline.

**The tiles (#241).** Ten pages opened with a three- or four-tile stat
grid, and on a normal day most tiles read 0 in the same size and weight
as a real alert, so colour was spent on nothing and the one figure that
mattered did not register. Each is now one `StatusLine`: a quiet
sentence in the body colour carrying the figures the tiles used to show,
and red or amber ONLY for money or a deadline at risk. "Nothing late. 4
orders outstanding, 12 delivered." on a good day; "2 orders past the
promised date — Tighties LLC (9 days), ABC Supply (3 days)." on a bad
one, because a number is not something to pick up the phone about and a
name is. The sentences are pure functions in `lib/status-sentences.ts`
with every wording pinned, so "raises its voice only when something is
wrong" is a test rather than a hope. Safety and the assistant page never
colour: a recordable case is a record, not a deadline. The app-wide
colour budget stays with Cyrus's token conversation; this only removes
the tiles. And `/cash-flow` no longer says "AR aging" to a drywall
office manager without saying what it means first.

**Photo storage, on `/settings/integrations`.** Which Blob store this
deployment uploads to, from the credential it holds (the store id is the
first label of every photo URL, never a secret; the token is never
shown). Exists so "does the preview have its own store" is answered by
opening one page in two places rather than by reading a build log —
Diego's call of 9 Sep was that previews must not upload beside real
photos, and until now nothing on screen could confirm it either way.
