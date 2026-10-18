### A bid workspace for the AI agents, a page that shows what they did, and "why did we win or lose" on every decided bid (Cyrus)
`cyrus/ai-bidui`

`/ai/bids/[id]` shows one bid the way the agents see it, in four steps:
Research, Estimate check, Addenda and Decision. Each step is a link to
`?tab=`, built like the job stage steps, so back and forward work and a
keyboard reaches every step without any scripting. Every finding shows its
sources as links. A record opens inside the app, a web page opens in a new
tab, and a step that has never run says so, with a button to run it. The
Decision step labels the recommendation "Advice — you decide". Under it is
either the recorded outcome or the form to record one, and beside both sits
the Ask panel with this person's earlier questions about the bid. Threads
belong to one user, so the page lists only the signed-in person's.

`/ai/activity` merges the agent runs, findings and recommendation events into
one timeline. Items are grouped by the reader's own calendar day, not the
server's, and the list can be filtered by agent through `?agent=`. Next to it
are the agent settings: four switches, the due-soon window (1 to 30 days),
the monthly spend cap (blank means no cap, and this month's agent spend is
shown beside it), and who gets notified. Only the owner can change them.
Anyone else sees the same values with every control disabled and a line
saying who can change them, never a form that can only come back refused.
A finding someone dismissed stays on the timeline, tagged Dismissed, with a
Restore button.

On `/bids`, a won or lost row now offers "Record why", collapsed per the
list-page convention, or shows the reason already recorded. That outcome is
the only thing the bid-or-pass recommendations learn from.

The check: `components/ai-bid/aiBid.render.test.tsx` and
`components/ai-activity/aiActivity.render.test.tsx` mount all of this in
happy-dom. Mutation-tested by widening the due-soon bound from 30 to 300:
the "refuses a window outside 1 to 30 days" test went red, then green again
once the bound was restored.

`client-boundary.test.ts` also caught a real bug before it shipped. The
reason labels lived in the "use client" form, so the server-rendered /bids
row would have received a client-reference proxy instead of the function.
Those helpers now live in plain modules (`components/ai-bid/outcome.ts`,
`components/ai-activity/settingsForm.ts`).
