### A save on the phone shows up straight away (Diego)
`diego/phone-sync-speed`

After a save on the phone, the list sometimes took several seconds to
show it. The entry had reached the server; the list just refreshed late.
Measured on production: every phone API call took 0.5–1s, and the Time
screen made eight of them after a save, mostly one batch after another.

- **The server stops asking Clerk on every request.** `requireApiContext`
  fetched the full Clerk user (a network round trip to Clerk) before even
  looking in the database. It only needs that to *link* someone new. A
  person it already knows is now answered from the database alone.
- **The Time screen loads everything at once** and shows each part as it
  arrives, instead of waiting for the slowest batch.
- **A just-saved time entry or delay appears immediately**, marked
  "Syncing…". The server's copy replaces it when it comes back. If the
  server refuses it, the row goes away and the "wasn't saved" banner says
  why. While it's still waiting to send, for example offline, the row stays
  on screen instead of vanishing on the next reload.
