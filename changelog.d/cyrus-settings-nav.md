### Settings is pinned to the bottom-left of the sidebar (Cyrus)
`cyrus/settings-nav`

Cyrus, the account owner, could not find Settings. It sat last inside the
Financials group, which starts collapsed, so on most pages it was simply
not on screen. It is now the rail's footer — `NAV_FOOTER` in
`navItems.tsx`, drawn below the scrolling groups on the desktop rail and at
the bottom of the mobile drawer — and is shown to whoever can reach
`/settings`, by the same `canReach` rule the groups use.

`navItems.test.ts` now accepts a footer item as reachable, pins that
Settings is in the footer and in no group, and that a field member (who
cannot reach /settings) gets an empty footer. `/settings/*` pages open no
group any more, since Settings belongs to none. Clicked in the browser:
Settings is at the bottom-left on the dashboard and highlighted on /settings.
