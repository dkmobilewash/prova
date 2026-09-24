### Alert pushes: the phone hears the digest, and a tap answers (Diego)
`diego/alert-push` — no issue

The push pipeline was built at both ends and connected by nothing: the
phone registered its token, `sendExpoPush` existed, `assignCrewMember`
already pushed — and no tap went anywhere. Now the daily alert digest
has a push half and the phone has somewhere for the tap to land.

**The channel is a prefix, not a column.** `dispatchAlertPush` rides the
same unattended run, same budget, same one-at-a-time order, with
`push:`-prefixed claims over the same `NotificationDispatch` ledger —
email and push are claimable independently, so a phone user still gets
email. A channel column would have needed a migration and a backfill for
a property the prefix already provides. The email dispatcher's lessons
are carried over verbatim: devices checked before any alert assembly,
config checked before any claim (an install without EXPO_ACCESS_TOKEN
burns nothing), per-principal filtering via the same `loadAlerts` — never
its OWNER default — and a failed provider send releases exactly the rows
this call created. Push failures and an unconfigured token are recorded,
never a stop; the run's status stays the email's. No `OutboundMessage`
rows for pushes: `messageId` is nullable for this shape and the ledger
row is the evidence. Rendering pushes in `/messages` is a
messaging-vertical decision, deferred on purpose.

**A tap now answers.** The root layout mounts a tap router inside
ClerkProvider and outside the handover gate: cold-start responses are
read and consumed before routing, warm taps come through the listener,
only the DEFAULT action navigates, and a handover open on disk swallows
the tap — the way out of a handover is handing the phone back, not a
notification. `{ target: "alerts" }` opens the new phone Alerts screen
(v1/alerts, deliberately unguarded beyond the session — fourteen kinds
behind eight capabilities, filtered per principal and money-stripped
server-side already); the existing `{ jobId }` assignment push now opens
its job.

**Ops:** EXPO_ACCESS_TOKEN must be added in Vercel (documented in
apps/web/.env.example; unset = every push reports configured and is
skipped, never thrown). Push needs a native build, not Expo Go — the
same caveat #294 left behind. The Send-digest button pushes the clicker
too, so the whole path is exercisable by one person on demand.

**The check:** 42 web notification tests (claim ordering, channel
independence, release paths, run semantics) and 9 mobile tests (the
payload contract and the tap router, cold and warm, handover swallow),
plus the guards census pinning v1/alerts OPEN — all green.
