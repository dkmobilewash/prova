### Walls get their own auto-post switch, OFF for every company; doors keep theirs, ON for new companies (Diego)
`diego/autopost-walls`

Walls auto-post stands on 417 ft of held-out evidence (none wrong). Marked doors stand on much
more, so Diego's ruling keeps door auto-post on for new sign-ups and walls off for everyone until
the walls evidence grows.

- **New column `Company.autoPostWalls`** (migration `20261114203000_add_company_auto_post_walls`).
  It defaults to `false`, with no backfill, so every existing company starts with walls off.
- **Walls read it.** `wallItems.ts` posts a high-confidence wall or a proven-source wall type
  only with `autoPostWalls` on.
- **Doors are unchanged.** `autoDoors.ts` still reads `autoPostOn`, and signup still creates
  companies with `autoPostOn: true`. The door switch now never posts a wall.
- **Settings** shows both switches, owner-only, with one line each ("Auto-post marked doors",
  "Auto-post walls"), saved together.

The check: `autoPostWalls.test.ts` covers the default, the migration with no backfill, signup
keeping doors on, which switch each path reads, and both toggles. `autoPost.dbtest.ts` checks
that with the door switch on and the walls switch off no wall posts itself and a marked door does;
reading the door switch for walls turns it red.
