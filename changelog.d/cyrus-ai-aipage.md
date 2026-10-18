### The AI page, and "AI" in the top bar and the phone's tabs (Cyrus)
`cyrus/ai-aipage`

/ai stops being a placeholder. It is the chat on the left and, beside it,
what the background agents are doing: **Running now** (every run with its
status — Running with a spinner, Done, Failed, Skipped, and "Paused: cap
reached" when the month's AI spend cap stopped it, so "why did nothing run"
has an answer on screen), **Recommendations** (ranked cards, each with its
reason, confidence and the records it read, an Open link, and one-tap Done or
Dismiss — no confirm, because both are reversible) and **Watching** (open
bids, the ones due this week linked to their AI workspace, unread addenda,
when the watcher last checked, and the latest findings with their sources and
a Fix link). Every list that is empty says what fills it and offers a way out
— Run now for the watcher and recommendations, or a link to bids. Nothing on
the page is a made-up number. On a phone the agents fold into one strip,
"2 running · 3 recommendations", above the chat.

AI is the fourth word in the desktop top bar and the fifth tab on a phone,
with a small count when there are open findings. Five tabs fit at 390px:
measured in Chromium, each tab is 74x64 against a 64px icon and a 58.8px
"Schedule" label, nothing truncates. Only people who can open /ai
(MANAGE_ESTIMATING, the same as /bids) see the word, the tab or the count.

The separate "Ask C Stream" button in the top bar is gone for anyone who has
the AI word — two doors to the same assistant read as two things. People
without AI (a field user) keep it, or the assistant would be on no page for
them. An empty state's "Ask C Stream to do it" still works for everyone: it
opens the launcher when there is one and otherwise goes to /ask with the
sentence waiting. On a fresh /ai the space under the chat lists your recent
conversations; Watching sits second in the column so what is due this week
is on screen at 1440x900 without scrolling (measured: the first due bid ends
at 545px).

/ai is filed under Jobs & bids on the home page and in "All pages", next to
Bids, and has a four-step walkthrough. It is not a seventh area: one page
does not need its own box. /ai/activity and /ai/bids/[id] are reached from
/ai, not from the nav.

Click check: sign in as an owner, the top bar reads Jobs · Money · Schedule ·
AI, and AI is underlined on /ai. Sign in as a field user and AI is not there
at all. With no agent rows yet, /ai shows three sentences and two Run now
buttons, never an empty box.
