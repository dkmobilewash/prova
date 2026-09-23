### The phone red-screened at every launch since #405 (Diego)
`diego/hotfix-clerk-provider-drain` — one file, no issue

#405 moved the queue-drain timer from the tabs to the root layout so a
crew member's hours keep draining during a handover — and put the
`useQueueDrain()` call in `RootLayout` itself, ABOVE the `ClerkProvider`
it depends on. The drain reads the session token through `useAuth`, so
every launch died with "useAuth can only be used within the ClerkProvider
component" before anything drew. Found on a phone, not in review:
nothing in CI can see a runtime-context dependency.

The call now lives in a `DrainTimer` component rendered beside the
handover gate — inside the provider, outside the gate, which preserves
both halves of #405's intent.

**The check:** the app launches to the tabs, and the rails test in the
redesign PR (#427) pins the placement; this branch carries the
one-line-at-a-time discipline deliberately — the guard rides with the
redesign rather than doubling the diff here.
