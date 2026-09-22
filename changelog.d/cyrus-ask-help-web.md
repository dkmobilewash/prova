### Ask can now answer "how do I…" from the app's own walkthroughs, and can search the public web (Cyrus)
`cyrus/ask-help-web`

Two additions to the Ask loop, both read-only.

**`app_help`.** "How do I log a backcharge", "where do I add a punch list
item" used to have no answer — every read tool answers a question about
the company's own DATA, and none of them cover "how do I use this app".
`app_help` (`lib/ask/appHelp.ts`) searches the same registry the in-app
"Walk me through this page" tour already reads (`lib/walkthroughs`), so a
step corrected for the tour is corrected here too — there is no second
copy of the content to drift from it.

Matching is word-start, not plain substring: an early version summed every
occurrence of a query word across a walkthrough's steps, which let a
generic verb ("log", "add") that happens to appear in several unrelated
pages outrank a page that only weakly matches — caught when "log a
backcharge" (with the backcharges page filtered out below) still surfaced
the job detail page, purely because it also says "log time" and "log a
day". `startsWord` requires a word BOUNDARY before the term, which also
kills a coincidental spelling collision the substring version had: "log"
no longer matches inside "catalog". `isRelevant` then requires either one
term to hit a walkthrough's own title or route, or two distinct terms to
corroborate each other — a single generic word landing once in one page's
body clears neither bar.

**Capability filtering happens INSIDE the handler, not on the tool.**
`app_help`'s own `capability` is `null` — it is offered to everyone — because
WHICH pages it may name varies per person, the same shape `needs_attention`
and `getting_started` are already built around. `reachableWalkthroughs`
filters the candidate list against each matched page's own
`ROUTE_CAPABILITY` entry before `searchAppHelp` ever scores it, so a FIELD
member asking about a backcharge is told nothing matches, never handed a
page they cannot open. Mutation-tested: dropping the filter (`return true
|| …`) turns 4 of 19 `appHelp.test.ts` cases red; restored byte-identical
after.

**Web search.** The Ask loop can now offer Anthropic's server-side
`web_search_20250305` tool alongside the app's own tools, for PUBLIC facts
this company's own data never will contain — a form number, a code
requirement, a phone number. `packages/integrations/src/ask.ts` clamps
`max_uses` to `ASK_WEB_SEARCH_MAX_USES` (3) rather than trusting a caller —
mutation-tested by removing the `Math.min` clamp, which turns 2 of 11
`webSearch.test.ts` cases red. The tool is the SAME `WebSearchTool20250305`
variant `research.ts` already runs in production (the installed SDK's
types are the constraint on both), appended AFTER the app's own tools so
the client tool list keeps its cached byte order.

`SYSTEM_PROMPT` carries the rules: never a substitute for a tool that
already answers the question, never company data going INTO a search
query, and every result framed "found on the web — check before you rely
on it" rather than stated as flatly as this company's own figures.

**Usage.** A search bills per search on top of tokens, so it is tallied
apart from them (`AskUsageTotals.webSearches`, from
`usage.server_tool_use.web_search_requests`). LOGGED, NOT STORED — no
`AskUsage` column fits a search count, and this table's own rule is that a
new figure must not force a migration or get folded into an existing one
that means something else. The runtime log (`[ask] usage`) is the record
until a column is judged worth a migration; the spend stays bounded either
way, at `ASK_WEB_SEARCH_MAX_USES` times the existing per-person and
per-company row limits.

**Tests.** `appHelp.test.ts` (19 cases): the index picks the right page for
four different phrasings, capability filtering for FIELD vs. ACCOUNTING vs.
OWNER, and the handler end to end. `webSearch.test.ts` (11 cases): the tool
variant, the clamp, request construction (appended last, byte-identical
across passes), the usage tally, and `pause_turn` handling. Both census
tests (`tools.test.ts`'s citation guard, `eval/cases.test.ts`'s coverage
guard, `eval/top-questions.test.ts`'s coverage guard, `commands.test.ts`'s
capability guard) extended for the new tool rather than worked around.
`injection.test.ts` and `injection.batch.test.ts` reverified green,
unchanged. `halt.test.ts` had one exact-equality assertion updated for the
new `webSearches: 0` field the usage totals now always carry.

Seven new census cases in `eval/cases.ts` (`help-*`, `web-*`), run live
with `vitest -t` rather than the full suite — see the PR for which ones and
what they cost.
