### The assistant remembers the conversation and never the facts (Cyrus)
`cyrus/ask-page-context`

A construction manager reviewing C Stream said it was not tracking previous
questions, and he was right — `ask.prisma` has `AskProposal` and `AskUsage`
and no thread of any kind. Every question stood alone, so "now do the same
for Cedar Park" had nothing to reach back to. That is most of what made a
box that can do sixteen different things feel like a search field.

**`AskPanel`'s header said this was deliberate, and it was — which is why
this is not a reversal of that decision but a narrower reading of it.** Its
reason, verbatim: *"a scrollback of stale answers is a place for a number to
be read long after it stopped being true."* On a product whose whole claim is
that it will not show a figure that looks complete and is not, that is
correct and worth protecting.

So the split: **memory carries the CONVERSATION, never the FACTS.**

The last few questions and answers travel with the next question so the
assistant can resolve "the same", "that job", "it" — what a person says to a
colleague who was listening. **Tool results do not travel.** Every figure in
the new answer still comes from a fresh tool call, because the system
prompt's standing rule did not move: every fact comes from a tool call in
THIS conversation. A stale number therefore cannot survive into a new
answer — not because it is filtered out, but because nothing quotes it.
Replaying old tool results is the version of this feature that would have
broken the rule, and is exactly what was left out.

**No scrollback is rendered.** Old answers are not redisplayed; asking again
replaces what is on screen exactly as before. What changed is what the
assistant can hear, not what the reader can see. `PRIOR_TURNS_RULE` states
the distinction to the model, and only when there IS history — a paragraph
explaining what earlier answers are not, on a question with none, is prompt
weight bought for nothing.

**No migration, and that is a deliberate choice rather than a shortcut.**
The turns live in `sessionStorage`, for the reason the pending card already
uses it: *it dies with the tab*. A jobsite tablet passed between two people
must not carry one person's questions into the next person's session, and
nothing about a conversation needs to outlive the sitting. Nothing is stored
server-side.

They therefore arrive from a browser, and are treated as such.
`lib/ask/turns.ts` bounds them to 6 turns and 2,000 characters each, drops
malformed entries without ever throwing (a bad entry in stored history must
not stop somebody asking a question), and **refuses any role that is not
`user` or `assistant`** — `system`, `developer` and `tool` are rejected, so
nothing from a request body can reach the trusted system block. They are
prepended as real conversation turns in the USER role, where the existing
injection suite already assumes content is hostile.

"Ask something else" now clears the remembered turns as well as the result,
which is what its name has always promised.

Both headers this touched are amended in the diff rather than left to rot:
`AskPanel`'s "Nothing here remembers a previous question", and — from the
page-context work on the same branch — `/api/ask`'s "nothing is read from
the request body except the question".

**Mutations**, each watched red and restored:

| broke | caught by |
| --- | --- |
| accept any role, not just user/assistant | the system/developer/tool rejection test |
| drop the `MAX_TURNS` bound | the most-recent-turns test |
| drop the leading-assistant shift | the never-starts-on-assistant test |
| stop truncating an over-long turn | the payload test |

The third is the one that would have shipped as an outage rather than a
weakness: slicing a tail can land mid-exchange, and a conversation opening
on an assistant turn is a 400 from the API, not a degraded answer.

test 3210/3210 (190 files), lint clean, typecheck clean, build green.
