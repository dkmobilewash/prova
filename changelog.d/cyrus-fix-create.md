### The things a sub creates are one tap away, and one thing has one name (Cyrus)
`cyrus/fix-create`

Six contractor-persona findings and an expert review of the Concept G
build (2026-10-11) said the same thing from different seats: reading the
app was good, creating in it was not. A bid invitation could only be
logged from the GC's contact page; raising an RFI, filing a daily report
or adding a photo was 3-4 taps through an area, a list and a collapsed
form; lien waivers lived only at the foot of a job's Billing tab; the
same bill was "Invoice #14" on Home and "Pay app #4" on the job; a failed
agent run was a dead end; and no bid anywhere was clickable, so the bid's
own AI page (Research, Estimate check, Addenda, Decision) was unreachable.

What changed, and the check that proves each:

- **"+ Log a bid"** on /bids (collapsed add-form with a GC picker), on the
  Jobs & bids card and its home dropdown, and in the command palette. It
  calls `createBidInvitation` exactly as the contact page does — the action
  is untouched. `bids/page.test.ts` renders the picker on `?new=1` and
  not without it. `capabilityForRoute` now drops a query or anchor before
  its lookup, so `/bids?new=1` gates as `/bids` instead of reading as open
  to everyone; `palette.test.ts` holds FIELD away from it.
- **Home quick actions**: the phone tiles the Concept G mockup had (Take a
  photo, New RFI, Daily report) are back under "Log today's hours", and the
  desktop chips gain the same three. Each lands with the form OPEN —
  `/rfis`, `/field-reports`, `/submittals`, `/material-orders` and
  `/backcharges` read `?new=1` (`open-on-new.test.ts` opens on `?new=1`
  and only then); a photo goes through the job picker. Cmd-K gains the
  create verbs a sub says and synonyms ("crews" finds Schedule and Log
  hours, "CO", "DFR", "pics", "invoice"); the Ask row says "Uses AI".
- **Lien waivers** are a row in the job's Paperwork panel (anchored to the
  Billing section) and a per-job list under the Money area's Lien
  deadlines page. Links to the existing section only; nothing new stores
  anything.
- **One name**: `billingNoun(company.filesMonthlyPayApps)` says "Pay app"
  or "Invoice" at every site — Home's Needs, the job card's Chase button,
  the stage line, the register heading, the Send shortcut. `/catalog` is
  "Price book" everywhere; the nav says "Jobs"; All pages files every page
  under the six area names (`areas.test.ts` fails on a retired name).
- **A way out of every stopped run**: Failed and stalled rows offer "Run
  again" (the existing `RunAgentButton`/`runAgentNow`, same gate); a run
  paused on the cap links to the cap; a skipped run links to the switch
  that skipped it; Home no longer cuts the failure reason to one line.
  `aiParts.render.test.tsx` renders each.
- **Bids are clickable**: the project name opens `/ai/bids/<id>` on /bids,
  in the area's Waiting rows, on /ai Running now and /ai/activity, and
  Cmd-K searches bids. Cmd-K also stops spinning: a search that has not
  answered in 10s says "Search took too long — try again." and every
  provider is pinned to its `take`. Help no longer prints "needs
  SUPPORT_EMAIL set" to a customer. The top-bar button reads "AI tasks".
- Meaning-bearing 12-13px text on Home, the AI parts and the Billing tab
  is 14px; the Crew & field dropdown lists Log hours first and lays its
  tools out two-up so it fits a 706px-tall window without an inner scroll.

Not done, on purpose: marking a finding "this is wrong" as distinct from
dismissing it needs a column `AgentFinding` does not have (it has only
`dismissedAt` and `dismissedByUserId`), and a UI-only "wrong" that calls dismiss would lie — so it
waits for a migration, announced first. `ChangeOrders.tsx` gained an
`id="change-orders"` anchor so Cmd-K's "Log a change order" lands on the
section; that is one attribute in Diego's lane and is flagged for his nod.
