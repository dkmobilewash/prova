### New companies start with auto-post OFF; the owner turns it on in Settings (Diego)
`diego/autopost-default-off`

Walls auto-post on 417 ft of held-out evidence (none wrong). That is too little to post walls to
every new company's estimate unasked, so until there is more, auto-post is off for everyone until
an owner ticks "Auto-post proven items".

The column has been `@default(false)` since it was added (migration 20261110120000), so there is
**no migration**. What turned it on was signup, which created every new company with
`autoPostOn: true`. That line is gone, and existing companies keep whatever they have.

The owner switch already existed and is owner-only. Its explanation still said "nothing posts yet",
which stopped being true once marked doors and, with the run model on, high-confidence walls began
posting. It now says, in one line, what posts and that it is off until turned on.

The check: `autoPostDefault.test.ts` checks the schema default, that signup creates a company
without it (red with the old line), that the owner's action is the one writer, and the switch's
wording.
