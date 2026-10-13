### Concept G stops cutting off the words that matter: stage status, tool buttons (Cyrus)
`cyrus/g-polish`

**A job stage says its whole status.** At 1555px the Billing step read
"Pay app #2 overdue 8 d…", which cut off how late it was. On a desktop the
status now wraps, balanced ("Pay app #2 / overdue 8 days"), and the grid
stretches all five steps to the tallest, so they stay one height (measured
in Chromium at 1280, 1440, 1555 and 1600: 91px for each of the five). On a
phone the pills may still cut a long status short, but every word stays in
the pill's text and title. The stage in view also says its status in full
under the row ("Billing: Pay app #2 overdue 8 days"). Check:
`jobPage.render.test.tsx`. Mutation-tested: putting the old bare `truncate`
back turns it red.

**Area tool buttons fit their label.** "Open Closeout & …" and "Open
Document i…" were cut. A tool whose name is too long for a desktop card now
has its own short label in `lib/areas.ts` ("Open closeout", "Open intake",
"Open clauses", "Open fringe"). The button no longer truncates; if a label
is ever too long, it wraps instead. `areas.test.ts` caps every label at the
length measured to fit: 18 characters in an area of six or more tools,
where the button is 158px, and 21 in smaller areas, where it is 200px or
wider. Mutation-tested: dropping "Open intake" turns it red. On a phone the
button is full width (308px at 390).

**From a signed-in click test, three more.** On the home page the top bar
no longer lights "Jobs". It did because Jobs links to `/dashboard#jobs`,
which made Home and Jobs look like the same tab. Now no word is lit on home
(the wordmark is home), and Jobs is lit on a job and on the Jobs & bids
area (`shell.test.tsx`, mutation-tested). The Jobs card on the Jobs & bids
area had only "+ New job", so there was no way to open the list from it.
It now has "+ New job" in yellow and "Open jobs" under it
(`areas.render.test.tsx`, mutation-tested). On Needs you today, an expired
document's timing ("expired 19 days ago") was grey beside a red dot. It now
uses the danger tone, like an overdue invoice (`new-account.test.ts`,
mutation-tested).

**The sweep.** Search results now wrap their subtitle (two lines) instead of
truncating it, because the subtitle ends in the status ("Northgate … —
Submitted"). Crews today, the phone's Log hours tile, and the area-box
dropdown descriptions keep their one-line cut, but now carry the full text
in a title. Needs-you rows already did. In Chromium, nothing at 1280–1600
truncates a date, an amount or a status.
