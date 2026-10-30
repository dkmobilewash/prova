-- AlterTable: the grey-out becomes an OFF switch so it can be ON for every
-- company without an UPDATE over customer rows. Additive, NOT NULL with a
-- DEFAULT, so every existing row gets false — which means ON — for free.
--
-- "demotedWallsOn" is deliberately NOT dropped here. The deploy that stops
-- reading a column has to be live before the drop, or the running build
-- selects a column that no longer exists (CLAUDE.md, #378: two and a half
-- minutes of P2022 on /punch-lists). The drop is its own PR.
ALTER TABLE "Company" ADD COLUMN "demotedWallsOff" BOOLEAN NOT NULL DEFAULT false;
