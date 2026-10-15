### What the AI agents are doing, from every page, and a denser app (Cyrus)
`cyrus/ai-tasks-compact`

The owner asked for "a section so that they can see the current tasks that
are running", and to "compact everything".

**Tasks in the top bar.** Anyone who can open /ai (MANAGE_ESTIMATING, the
same gate as the AI word) gets a Tasks item beside Help. While agents run it
shows a spinner and "2 running"; otherwise a quiet "Tasks". It opens a list of
what is running (the agent, the bid, what it is doing, when it started) and
the last five that finished: Done, Failed with its reason, "Paused: cap
reached", Skipped. Each row links to the bid's AI workspace or to
/ai/activity, with "Open AI" and "All activity" at the foot. Esc closes it and
returns focus, a click or Tab outside closes it, and it and the avatar menu
are never open together. On a phone the spinner and the count show only while
something runs; the same runs are on /ai's agents strip. The home page has a
compact Running now card beside Needs you today, under Crews today, which is
not drawn until an agent has run.

The data is /ai's own loaders (`listRunningNow`, `listRuns`), read in the
layout behind the capability and settled like the AI badge, so a failure
costs the item, never the page. Next keeps the layout across client
navigations, so while the list is open or a run is going the item asks
`GET /api/agents/tasks` every 30s. It skips while the tab is hidden and stops
when nothing runs. A run still marked RUNNING after 15 minutes has lost its
process, so it shows as "Stopped responding" rather than spinning on every
page. That status is derived on read and never stored.

**Denser.** Home, the area boxes and area pages, the job header, stage steps,
pay-app summary and Paperwork panel, and /ai's column are tighter: smaller
padding, gaps and headline sizes. Every page's top gutter lost 8px
(`PageShell` `py-8` to `py-6`). Under a mouse, row links drop from 44px to
32–36px through a new `mouse:` Tailwind variant (`pointer: fine`). On a touch
screen they stay 44px, measured in Chromium with touch emulation. Needs you
today shows eight rows before "and N more", up from six. Measured at
1440x900 with the same fixture: Your jobs moved up from y=910 to 745 with no
agent runs (923 with the Running now card), the job page's Paperwork panel
from 413 to 346, /ai's Watching heading from 502 to 447, and an area page
shows five waiting rows above the fold where it showed two. No date, amount
or status truncates. The only text cut short is a run's detail line on the
home card, where the full text is in its title.

Checks: `lib/agents/tasks.test.ts` (the stalled rule, mutation-tested by
removing it) and `components/shell/tasksMenu.test.tsx` (the gate, Esc and
focus, one menu at a time, and refresh only while running and visible,
mutation-tested by removing the hidden-tab skip). The shell-port census lists
the new panel's viewport clamp with its reason.
