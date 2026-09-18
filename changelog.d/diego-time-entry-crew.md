### Log time is a crew sheet — pick everyone at once, adjust one person's hours, copy yesterday's crew (Diego)
`diego/time-entry-crew`

A foreman with fourteen hangers filled the Log time sheet fourteen times:
one person, one craft, one entry per save. Procore (bulk + Copy From
Previous), Sage (crew checklist, add late employee) and Busybusy
(multi-select, one set of details) all beat that, and it is this app's
primary user.

- **Multi-select "Who".** Me and any crew members; one date, one "hours for
  everyone", one pay type and cost code for all of them.
- **Per person:** a row with an hours box that defaults to everyone's hours
  (fill it in for a late arrival or an early out) and that person's own
  craft — filtered and auto-picked exactly as the single sheet did. Save
  stays grey until every row has valid hours and a craft, and says how many
  entries it will write.
- **Copy crew from <last day>.** Fills the people, hours, crafts and cost
  code from the last day this job had hours. A person who switched crafts
  that day comes back as one row under the craft they spent most of it on;
  archived crew are dropped; a craft they no longer work under is re-picked.
- One TimeEntry per person, each through the existing offline queue with
  its own idempotency key.

The time-entries list now also returns `crewMemberId`, `lineItemId`,
`craftClassificationId` and `mine`, which the copy needs. Additive; no
migration.

**Also fixed:** every bottom sheet is capped below the status bar and its
fields scroll between a fixed title and a fixed primary button. The Log time
sheet had grown past the screen, pushing its title behind the status bar.
